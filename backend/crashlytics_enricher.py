"""
Crashlytics BigQuery Enricher for Openfix
Queries BigQuery to enrich crash data with stacktrace, device info, and OS details.
"""

import json
import threading
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path("/app/data")
CRASHES_FILE = DATA_DIR / "crashes.json"
CONFIG_FILE = DATA_DIR / "config.json"

# Will be set from slack_listener.py
_ws_manager = None
_loop = None


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
        scopes=["https://www.googleapis.com/auth/bigquery.readonly"],
    )
    return bigquery.Client(project=project_id, credentials=credentials)


def _build_table_name(app_package: str, platform: str) -> str:
    """
    Build the BigQuery table name from app package and platform.
    e.g. com.smartsolving.gymtor + Android → com_smartsolving_gymtor_ANDROID
    """
    sanitized = app_package.replace(".", "_").replace("-", "_")
    return f"{sanitized}_{platform.upper()}"


def _extract_stacktrace(exceptions_field) -> str:
    """Extract a readable stacktrace from the BQ exceptions field."""
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
        table_name = _build_table_name(app_package, platform or "ANDROID")

        crash_time = datetime.fromisoformat(crash["timestamp"])
        start_ts = crash_time - timedelta(hours=2)
        end_ts = crash_time + timedelta(hours=2)

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

        results = client.query(query, job_config=job_config)
        rows = list(results)

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
            "enriched": True,
        }

        # Update crash in crashes.json
        crashes = _load_crashes()
        for c in crashes:
            if c["id"] == crash["id"]:
                c.update(enrichment)
                break
        _save_crashes(crashes)

        print(f"Enricher: crash {crash['id']} enriched with BQ data")

        # Broadcast enriched data via WebSocket
        _broadcast_enriched(crash["id"], enrichment)

    except ImportError:
        print("Enricher: google-cloud-bigquery not installed, skipping")
    except Exception as e:
        print(f"Enricher: error enriching crash {crash['id']}: {e}")


def _load_crashes():
    if CRASHES_FILE.exists():
        with open(CRASHES_FILE) as f:
            return json.load(f)
    return []


def _save_crashes(crashes):
    with open(CRASHES_FILE, "w") as f:
        json.dump(crashes, f, indent=2)


def _broadcast_enriched(crash_id: str, enrichment: dict):
    """Broadcast crash_enriched event via WebSocket."""
    import asyncio

    if _ws_manager and _loop:
        data = {"crashId": crash_id, **enrichment}

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
