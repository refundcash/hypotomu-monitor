import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://www.okx.com";

interface OrderData {
  instId: string;
  tdMode?: string;
  side: string;
  posSide?: string;
  ordType?: string;
  sz: string;
  px?: string;
  reduceOnly?: boolean;
}

// In-memory cache for instrument info to prevent 429 rate limit errors
interface InstrumentCache {
  data: any;
  timestamp: number;
}

const instrumentCache = new Map<string, InstrumentCache>();
const INSTRUMENT_CACHE_TTL = 3600000; // 1 hour in milliseconds

export class OKXClient {
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private baseURL: string;
  public axios: AxiosInstance;

  constructor(apiKey: string, secretKey: string, passphrase: string, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.baseURL = testnet ? "https://www.okx.com" : BASE_URL;
    this.axios = axios.create({
      baseURL: this.baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  sign(timestamp: string, method: string, requestPath: string, body: string = ""): string {
    const message = timestamp + method + requestPath + body;
    const hmac = crypto.createHmac("sha256", this.secretKey);
    return hmac.update(message).digest("base64");
  }

  async getHeaders(method: string, requestPath: string, body: string = "") {
    const timestamp = new Date().toISOString();
    const sign = this.sign(timestamp, method, requestPath, body);

    return {
      "OK-ACCESS-KEY": this.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
    };
  }

  async getAccountBalance() {
    const path = "/api/v5/account/balance";
    const headers = await this.getHeaders("GET", path);
    const response = await this.axios.get(path, { headers });
    return response.data;
  }

  async getPositions(instType: string = "SWAP") {
    const path = "/api/v5/account/positions";
    const queryParams = `?instType=${instType}`;
    const pathWithParams = path + queryParams;

    const headers = await this.getHeaders("GET", pathWithParams);

    const response = await this.axios.get(pathWithParams, { headers });
    return response.data;
  }

  async getInstrumentInfo(instId: string) {
    // Check cache first
    const cached = instrumentCache.get(instId);
    const now = Date.now();

    if (cached && now - cached.timestamp < INSTRUMENT_CACHE_TTL) {
      return cached.data;
    }

    // Cache miss or expired - fetch from API
    const path = "/api/v5/public/instruments";
    const response = await this.axios.get(path, {
      params: {
        instType: "SWAP",
        instId,
      },
    });

    // Store in cache
    instrumentCache.set(instId, {
      data: response.data,
      timestamp: now,
    });

    return response.data;
  }

  async placeOrder(orderData: OrderData) {
    const path = "/api/v5/trade/order";
    const body = JSON.stringify(orderData);
    const headers = await this.getHeaders("POST", path, body);
    const response = await this.axios.post(path, body, { headers });
    return response.data;
  }

  async cancelOrder(instId: string, ordId: string) {
    const path = "/api/v5/trade/cancel-order";
    const body = JSON.stringify({
      instId,
      ordId,
    });
    const headers = await this.getHeaders("POST", path, body);
    const response = await this.axios.post(path, body, { headers });
    return response.data;
  }

  async getPendingOrders(instType: string = "SWAP", instId: string | null = null) {
    const path = "/api/v5/trade/orders-pending";
    let queryParams = `?instType=${instType}`;
    if (instId) {
      queryParams += `&instId=${instId}`;
    }
    const pathWithParams = path + queryParams;

    const headers = await this.getHeaders("GET", pathWithParams);
    const response = await this.axios.get(pathWithParams, { headers });
    return response.data;
  }

  async getTicker(instId: string) {
    const path = "/api/v5/market/ticker";
    const response = await this.axios.get(path, {
      params: { instId },
    });
    return response.data;
  }
}
