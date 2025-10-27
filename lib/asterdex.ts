import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

const FUTURES_BASE_URL = "https://fapi.asterdex.com";
const SPOT_BASE_URL = "https://api.asterdex.com";

interface OrderData {
  symbol: string;
  side: string;
  type?: string;
  quantity?: string;
  price?: string;
  timeInForce?: string;
  reduceOnly?: string;
  positionSide?: string;
}

interface AsterdexAuthParams {
  apiKey: string;
  apiSecret: string;
}

export class AsterdexClient {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  public axios: AxiosInstance;

  constructor(apiKey: string, apiSecret: string, isFutures: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseURL = isFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
    this.axios = axios.create({
      baseURL: this.baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private generateSignature(totalParams: string): string {
    const hmac = crypto.createHmac("sha256", this.apiSecret);
    return hmac.update(totalParams).digest("hex");
  }

  private getHeaders(): any {
    return {
      "X-MBX-APIKEY": this.apiKey,
    };
  }

  async getAccountBalance() {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = this.generateSignature(queryString);
    const finalQueryString = `${queryString}&signature=${signature}`;

    const path = "/fapi/v2/balance"; // Legacy API endpoint
    const headers = this.getHeaders();
    const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
    return response.data;
  }

  async getAccount() {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = this.generateSignature(queryString);
    const finalQueryString = `${queryString}&signature=${signature}`;

    const path = "/fapi/v4/account"; // Legacy API endpoint with positions
    const headers = this.getHeaders();
    const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
    return response.data;
  }

  async getPositions(symbol?: string) {
    const timestamp = Date.now();
    const params: any = { timestamp };
    if (symbol) {
      params.symbol = symbol;
    }

    // Build query string in alphabetical order for signature
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const signature = this.generateSignature(queryString);

    // Build final query string with signature
    const finalQueryString = queryString + `&signature=${signature}`;

    const path = "/fapi/v2/positionRisk"; // Legacy API endpoint
    const headers = this.getHeaders();
    const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
    return response.data;
  }

  async placeOrder(orderData: OrderData) {
    const timestamp = Date.now();
    const params: any = {
      ...orderData,
      timestamp,
    };

    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
    const signature = this.generateSignature(queryString);

    // Build the final query string with signature
    const finalQueryString = `${queryString}&signature=${signature}`;

    const path = "/fapi/v1/order"; // Legacy API endpoint
    const headers = {
      ...this.getHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Send as query string in the URL for POST request
    const response = await this.axios.post(`${path}?${finalQueryString}`, null, { headers });
    return response.data;
  }

  async cancelOrder(symbol: string, orderId: string) {
    const timestamp = Date.now();
    const params: any = {
      symbol,
      orderId,
      timestamp,
    };

    // Build query string in alphabetical order for signature
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
    const signature = this.generateSignature(queryString);
    params.signature = signature;

    const path = "/fapi/v1/order"; // Legacy API endpoint
    const headers = this.getHeaders();
    const response = await this.axios.delete(path, { headers, params });
    return response.data;
  }

  async getPendingOrders(symbol?: string) {
    const timestamp = Date.now();
    const params: any = { timestamp };
    if (symbol) {
      params.symbol = symbol;
    }

    // Build query string in alphabetical order for signature
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const signature = this.generateSignature(queryString);

    // Build final query string with signature
    const finalQueryString = queryString + `&signature=${signature}`;

    const path = "/fapi/v1/openOrders"; // Legacy API endpoint
    const headers = this.getHeaders();
    const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
    return response.data;
  }

  async getTicker(symbol: string) {
    const path = "/fapi/v1/ticker/24hr";
    const response = await this.axios.get(path, {
      params: { symbol },
    });
    return response.data;
  }

  async getExchangeInfo(symbol?: string) {
    const path = "/fapi/v1/exchangeInfo";
    const params: any = {};
    if (symbol) {
      params.symbol = symbol;
    }
    const response = await this.axios.get(path, { params });
    return response.data;
  }

  async getUserTrades(symbol: string, startTime?: number, endTime?: number, limit: number = 500) {
    try {
      const timestamp = Date.now();
      const params: any = { symbol, timestamp, limit };
      if (startTime) {
        params.startTime = startTime;
      }
      if (endTime) {
        params.endTime = endTime;
      }

      // Build query string in alphabetical order for signature
      const queryString = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");

      console.log(`[Asterdex] getUserTrades params:`, params);
      console.log(`[Asterdex] getUserTrades queryString:`, queryString);

      const signature = this.generateSignature(queryString);
      const finalQueryString = queryString + `&signature=${signature}`;

      console.log(`[Asterdex] getUserTrades finalQueryString:`, finalQueryString);

      const path = "/fapi/v1/userTrades";
      const headers = this.getHeaders();
      const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
      return response.data;
    } catch (error: any) {
      console.error(`[Asterdex] getUserTrades error:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw error;
    }
  }

  async getIncomeHistory(symbol?: string, incomeType?: string, startTime?: number, endTime?: number, limit: number = 100) {
    const timestamp = Date.now();
    const params: any = { timestamp, limit };
    if (symbol) {
      params.symbol = symbol;
    }
    if (incomeType) {
      params.incomeType = incomeType;
    }
    if (startTime) {
      params.startTime = startTime;
    }
    if (endTime) {
      params.endTime = endTime;
    }

    // Build query string in alphabetical order for signature
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const signature = this.generateSignature(queryString);
    const finalQueryString = queryString + `&signature=${signature}`;

    const path = "/fapi/v1/income";
    const headers = this.getHeaders();
    const response = await this.axios.get(`${path}?${finalQueryString}`, { headers });
    return response.data;
  }
}