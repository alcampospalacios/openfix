"""
Crashlytics BigQuery Enricher for Openfix
Queries BigQuery to enrich crash data with stacktrace, device info, and OS details.
"""

import json
import asyncio
import threading
from datetime import datetime, timedelta

from sqlalchemy import select

from db import get_session, Crash

# Will be set from slack_listener.py
_ws_manager = None
_loop = None

# Enrichment queue guard
_queue_running = False


def set_ws_manager(manager, loop):
    global _ws_manager, _loop
    _ws_manager = manager
    _loop = loop


def _get_bq_client(credentials_json: str, project_id: str):
    """Create a BigQuery client from service account credentials JSON."""
    from google.cloud import bigquery
    from google.oauth2 import service_account

    credentials_info = json.loads(credentials_json)
    credentials = service_account.Credentials.from_service_account_info(
        credentials_info,
        scopes=[
            "https://www.googleapis.com/auth/bigquery",
            "https://www.googleapis.com/auth/bigquery.readonly",
        ],
    )
    return bigquery.Client(project=project_id, credentials=credentials)


def _build_table_name(app_package: str, platform: str) -> str:
    sanitized = app_package.replace(".", "_").replace("-", "_")
    return f"{sanitized}_{platform.upper()}"


def _extract_stacktrace(exceptions_field) -> str:
    if not exceptions_field:
        return ""

    lines = []
    for exc in exceptions_field:
        exc_type = exc.get("type", "")
        exc_message = exc.get("message", "")
        lines.append(f"{exc_type}: {exc_message}")

        frames = exc.get("frames", [])
        for frame in frames:
            file_name = frame.get("file", "?")
            line_num = frame.get("line", "?")
            symbol = frame.get("symbol", "?")
            lines.append(f"    at {symbol} ({file_name}:{line_num})")

    return "\n".join(lines)


async def _update_crash_in_db(crash_id: str, enrichment: dict):
    """Update a crash row in the DB with enrichment data."""
    async with get_session() as session:
        crash = await session.get(Crash, crash_id)
        if not crash:
            print(f"Enricher: crash {crash_id} not found in DB")
            return
        crash.stacktrace = enrichment.get("stacktrace")
        crash.device = enrichment.get("device")
        crash.os_version = enrichment.get("os_version")
        crash.blame_file = enrichment.get("blame_file")
        crash.blame_line = enrichment.get("blame_line")
        crash.blame_symbol = enrichment.get("blame_symbol")
        crash.bq_issue_id = enrichment.get("bq_issue_id")
        crash.enriched = True

    print(f"Enricher: crash {crash_id} enriched with BQ data")


def _enrich_crash(crash: dict, config: dict):
    """Query BigQuery to enrich a crash with detailed information."""
    try:
        from google.cloud import bigquery

        firebase_project = config.get("firebase_project", "")
        firebase_credentials = config.get("firebase_credentials", "")

        if not firebase_project or not firebase_credentials:
            print(f"Enricher: no firebase config, skipping crash {crash['id']}")
            return

        exception_class = crash.get("exception_class", "")
        app_package = crash.get("app_package", "")
        platform = crash.get("platform", "")

        if not exception_class or not app_package:
            print(f"Enricher: missing exception_class or app_package, skipping {crash['id']}")
            return

        client = _get_bq_client(firebase_credentials, firebase_project)
        base_table = _build_table_name(app_package, platform or "ANDROID")
        # Try REALTIME table first, then batch table
        tables_to_try = [f"{base_table}_REALTIME", base_table]

        crash_time = datetime.fromisoformat(crash["timestamp"])
        start_ts = crash_time - timedelta(hours=2)
        end_ts = crash_time + timedelta(hours=2)

        rows = []
        for table_name in tables_to_try:
            query = f"""
                SELECT event_timestamp, issue_id, issue_title, issue_subtitle,
                       blame_frame.file AS blame_file,
                       blame_frame.line AS blame_line,
                       blame_frame.symbol AS blame_symbol,
                       exceptions,
                       device.manufacturer AS device_manufacturer,
                       device.model AS device_model,
                       operating_system.display_version AS os_version,
                       application.display_version AS app_version
                FROM `{firebase_project}.firebase_crashlytics.{table_name}`
                WHERE issue_title LIKE @exception_class
                  AND event_timestamp BETWEEN @start_ts AND @end_ts
                ORDER BY event_timestamp DESC
                LIMIT 1
            """

            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter(
                        "exception_class", "STRING", f"%{exception_class}%"
                    ),
                    bigquery.ScalarQueryParameter(
                        "start_ts", "TIMESTAMP", start_ts.isoformat()
                    ),
                    bigquery.ScalarQueryParameter(
                        "end_ts", "TIMESTAMP", end_ts.isoformat()
                    ),
                ]
            )

            try:
                results = client.query(query, job_config=job_config)
                rows = list(results)
                if rows:
                    break
            except Exception:
                continue

        if not rows:
            print(f"Enricher: no BQ results for crash {crash['id']}")
            return

        row = rows[0]

        stacktrace = _extract_stacktrace(row.get("exceptions"))
        device_manufacturer = row.get("device_manufacturer", "")
        device_model = row.get("device_model", "")
        device = f"{device_manufacturer} {device_model}".strip() if device_manufacturer or device_model else ""

        enrichment = {
            "stacktrace": stacktrace,
            "device": device,
            "os_version": row.get("os_version", ""),
            "blame_file": row.get("blame_file", ""),
            "blame_line": row.get("blame_line"),
            "blame_symbol": row.get("blame_symbol", ""),
            "bq_issue_id": row.get("issue_id", ""),
        }

        # Update crash in DB via the main event loop
        if _loop:
            asyncio.run_coroutine_threadsafe(
                _update_crash_in_db(crash["id"], enrichment), _loop
            )

        # Broadcast enriched data via WebSocket
        _broadcast_enriched(crash["id"], enrichment)

    except ImportError:
        print("Enricher: google-cloud-bigquery not installed, skipping")
    except Exception as e:
        print(f"Enricher: error enriching crash {crash['id']}: {e}")


def _broadcast_enriched(crash_id: str, enrichment: dict):
    """Broadcast crash_enriched event via WebSocket."""
    if _ws_manager and _loop:
        data = {"crashId": crash_id, "enriched": True, **enrichment}

        async def _do_broadcast():
            await _ws_manager.broadcast_to_frontends("crash_enriched", data)

        asyncio.run_coroutine_threadsafe(_do_broadcast(), _loop)


def start_enrichment(crash: dict, config: dict):
    """Start BigQuery enrichment in a background daemon thread."""
    thread = threading.Thread(
        target=_enrich_crash,
        args=(crash, config),
        daemon=True,
    )
    thread.start()


def _discover_bq_tables(client, firebase_project: str) -> list[dict]:
    """Discover all Crashlytics tables in the firebase_crashlytics dataset."""
    try:
        dataset_ref = f"{firebase_project}.firebase_crashlytics"
        tables = list(client.list_tables(dataset_ref))
        result = []
        for t in tables:
            name = t.table_id
            # Tables look like: com_example_app_ANDROID or com_example_app_IOS
            # Also REALTIME variants: com_example_app_ANDROID_REALTIME
            name_upper = name.upper()
            # Guess platform from name
            is_realtime = "_REALTIME" in name_upper
            platform = "ANDROID"
            if "_IOS" in name_upper:
                platform = "IOS"
            result.append({"table_id": name, "platform": platform})
        return result
    except Exception as e:
        print(f"BQ Sync: error discovering tables: {e}")
        return []


def fetch_crashes_from_bq(config: dict) -> list[dict]:
    """Query BigQuery for recent crashes and return them as dicts compatible with Crash model."""
    try:
        from google.cloud import bigquery

        firebase_project = config.get("firebase_project", "")
        firebase_credentials = config.get("firebase_credentials", "")
        app_package = config.get("app_package", "")
        platform = config.get("platform", "ANDROID")

        if not firebase_project or not firebase_credentials:
            print("BQ Sync: missing firebase_project or firebase_credentials")
            _broadcast_ws("bq_sync_error", {"error": "Missing firebase_project or firebase_credentials"})
            return []

        print(f"BQ Sync: connecting to BQ project={firebase_project} app_package='{app_package}' platform={platform}")
        client = _get_bq_client(firebase_credentials, firebase_project)

        # If we have app_package, try both REALTIME and batch tables. Otherwise discover.
        if app_package:
            base = _build_table_name(app_package, platform)
            tables_to_query = [
                {"table_id": f"{base}_REALTIME", "platform": platform},
                {"table_id": base, "platform": platform},
            ]
            print(f"BQ Sync: will try tables: {base}_REALTIME, {base}")
            _broadcast_ws("bq_sync_log", {"message": f"Using app: {app_package} ({platform})"})
        else:
            print("BQ Sync: no app_package, discovering tables...")
            _broadcast_ws("bq_sync_log", {"message": "No app_package configured. Discovering tables..."})
            tables_to_query = _discover_bq_tables(client, firebase_project)
            if not tables_to_query:
                print(f"BQ Sync: no tables found in {firebase_project}.firebase_crashlytics")
                _broadcast_ws("bq_sync_error", {"error": f"No Crashlytics tables found in {firebase_project}.firebase_crashlytics"})
                return []
            table_names = ', '.join(t['table_id'] for t in tables_to_query)
            print(f"BQ Sync: discovered {len(tables_to_query)} table(s): {table_names}")
            _broadcast_ws("bq_sync_log", {"message": f"Found {len(tables_to_query)} table(s): {table_names}"})

        all_crashes = []
        for table_info in tables_to_query:
            table_id = table_info["table_id"]
            tbl_platform = table_info["platform"]

            query = f"""
                SELECT DISTINCT
                    issue_id,
                    issue_title,
                    issue_subtitle,
                    application.display_version AS app_version,
                    application.build_version AS app_build,
                    MIN(event_timestamp) AS first_seen
                FROM `{firebase_project}.firebase_crashlytics.{table_id}`
                WHERE event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
                GROUP BY issue_id, issue_title, issue_subtitle, app_version, app_build
                ORDER BY first_seen DESC
            """

            print(f"BQ Sync: querying {table_id}...")
            _broadcast_ws("bq_sync_log", {"message": f"Querying {table_id}..."})

            try:
                results = client.query(query)
                rows = list(results)
                print(f"BQ Sync: {table_id} returned {len(rows)} rows")
                _broadcast_ws("bq_sync_log", {"message": f"{table_id}: {len(rows)} issue(s)"})
            except Exception as e:
                err_str = str(e)
                if "Not found" in err_str or "404" in err_str:
                    print(f"BQ Sync: table {table_id} not found, skipping")
                    _broadcast_ws("bq_sync_log", {"message": f"{table_id}: not found, skipping"})
                else:
                    print(f"BQ Sync: query failed on {table_id}: {e}")
                    _broadcast_ws("bq_sync_error", {"error": f"Query failed on {table_id}: {e}"})
                continue

            # Reverse-engineer app_package from table name if not provided
            tbl_app_package = app_package
            if not tbl_app_package:
                # Table is like com_example_app_ANDROID_REALTIME → strip known suffixes
                name = table_id
                for suffix in ("_REALTIME", "_ANDROID", "_IOS", "_WEB"):
                    if name.upper().endswith(suffix):
                        name = name[: -len(suffix)]
                tbl_app_package = name.replace("_", ".")

            for row in rows:
                issue_id = row.get("issue_id", "")
                crash_dict = {
                    "id": f"bq_{issue_id}",
                    "title": row.get("issue_title", "Unknown"),
                    "description": row.get("issue_subtitle", ""),
                    "timestamp": row.get("first_seen").isoformat() if row.get("first_seen") else datetime.utcnow().isoformat(),
                    "severity": "ERROR",
                    "status": "pending",
                    "source": "bigquery",
                    "exception_class": row.get("issue_title", ""),
                    "app_package": tbl_app_package,
                    "platform": tbl_platform,
                    "version": row.get("app_version", ""),
                    "enriched": False,
                }
                all_crashes.append(crash_dict)

        print(f"BQ Sync: fetched {len(all_crashes)} crashes from BigQuery")
        return all_crashes

    except ImportError:
        _broadcast_ws("bq_sync_error", {"error": "google-cloud-bigquery not installed in backend"})
        return []
    except Exception as e:
        _broadcast_ws("bq_sync_error", {"error": f"Unexpected error: {e}"})
        print(f"BQ Sync: error fetching crashes: {e}")
        return []


def is_queue_running() -> bool:
    return _queue_running


def run_enrichment_queue(config: dict):
    """Process all un-enriched crashes one by one. Meant to run in a daemon thread."""
    global _queue_running

    if _queue_running:
        print("Enrichment queue: already running, skipping")
        return

    _queue_running = True
    try:
        # Fetch un-enriched crashes via the async event loop
        future = asyncio.run_coroutine_threadsafe(_get_unenriched_crashes(), _loop)
        unenriched = future.result(timeout=30)

        total = len(unenriched)
        if total == 0:
            print("Enrichment queue: no un-enriched crashes")
            _broadcast_ws("enrich_queue_done", {"total": 0, "completed": 0})
            return

        print(f"Enrichment queue: processing {total} crashes")

        for idx, crash in enumerate(unenriched):
            crash_dict = {
                "id": crash["id"],
                "exception_class": crash.get("exception_class", ""),
                "app_package": crash.get("app_package", ""),
                "platform": crash.get("platform", ""),
                "timestamp": crash.get("timestamp", ""),
            }

            _broadcast_ws("enrich_queue_progress", {
                "total": total,
                "completed": idx,
                "current_crash_id": crash["id"],
            })

            _enrich_crash(crash_dict, config)

        _broadcast_ws("enrich_queue_done", {"total": total, "completed": total})
        print(f"Enrichment queue: done, processed {total} crashes")

    except Exception as e:
        print(f"Enrichment queue: error: {e}")
        _broadcast_ws("enrich_queue_done", {"total": 0, "completed": 0})
    finally:
        _queue_running = False


async def _get_unenriched_crashes() -> list[dict]:
    """Fetch all un-enriched crashes from DB."""
    async with get_session() as session:
        result = await session.execute(
            select(Crash).where(Crash.enriched == False)
        )
        crashes = result.scalars().all()
        return [
            {
                "id": c.id,
                "exception_class": c.exception_class,
                "app_package": c.app_package,
                "platform": c.platform,
                "timestamp": c.timestamp,
            }
            for c in crashes
        ]


def _broadcast_ws(event: str, data: dict):
    """Helper to broadcast a WS event from a thread."""
    if _ws_manager and _loop:
        async def _do():
            await _ws_manager.broadcast_to_frontends(event, data)
        asyncio.run_coroutine_threadsafe(_do(), _loop)
