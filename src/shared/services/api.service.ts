import { Injectable } from '@angular/core';
import { APP_CONFIG, isSyncConfigured } from '../config/app-config';
import { ApiTransport, BrowserSessionPersistence, XMoneyApiClient } from '../data-layer/api-client';

// Single instance of the xmoney-api client (token and refresh live here)
@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly configured = isSyncConfigured();
  readonly persistence = new BrowserSessionPersistence();
  readonly client = new XMoneyApiClient(APP_CONFIG.apiUrl.replace(/\/+$/, ''), this.persistence);
  readonly transport = new ApiTransport(this.client);
}
