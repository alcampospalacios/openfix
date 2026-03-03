import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable, filter, map } from 'rxjs';

interface WsMessage {
  event: string;
  data: any;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private messages$ = new Subject<WsMessage>();
  private reconnectTimer: any;
  private connected = false;

  constructor() {
    this.connect();
  }

  private connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/frontend`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        this.messages$.next(msg);
      } catch (e) {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('WebSocket disconnected, reconnecting in 3s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  on(eventName: string): Observable<any> {
    return this.messages$.pipe(
      filter(msg => msg.event === eventName),
      map(msg => msg.data)
    );
  }

  send(event: string, data: any) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  ngOnDestroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.messages$.complete();
  }
}
