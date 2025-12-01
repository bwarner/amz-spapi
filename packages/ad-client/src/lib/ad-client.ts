// import * as ManagerAccount_prod_3p from '@farvisionllc/amazon-ads-generated/ManagerAccount_prod_3p.js';

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

export interface AmazonAdsClientConfig {
  clientId: string; // LwA Client ID
  clientSecret?: string; // For token refresh
  accessToken?: string; // OAuth access token
  refreshToken?: string; // For automatic token refresh
  profileId?: string; // Advertiser Profile ID (used as Scope header when needed)
  scope?: string; // OAuth permission scope string (not sent as profile scope header)
  marketplaceId: string; // e.g., 'ATVPDKIKX0DER'
  region?: 'NA' | 'EU' | 'FE'; // Optional region override
  onTokenRefresh?: (accessToken: string, expiresIn: number) => Promise<void>; // Callback to persist new token
}

interface LwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: 'bearer';
  expires_in: number;
}

export class AmazonAdsApiClient {
  private httpClient: AxiosInstance;
  private config: AmazonAdsClientConfig;
  private BASE_URL = 'https://advertising-api.amazon.com';
  private LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
  private isRefreshing = false;
  private refreshPromise: Promise<string> | null = null;

  constructor(config: AmazonAdsClientConfig) {
    this.config = config;

    // Set region-specific URLs
    if (this.config.region === 'EU') {
      this.BASE_URL = 'https://advertising-api-eu.amazon.com';
      this.LWA_TOKEN_URL = 'https://api.amazon.co.uk/auth/o2/token';
    } else if (this.config.region === 'FE') {
      this.BASE_URL = 'https://advertising-api-fe.amazon.com';
      this.LWA_TOKEN_URL = 'https://api.amazon.co.jp/auth/o2/token';
    }

    this.httpClient = axios.create({
      baseURL: this.BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Amazon-Advertising-API-ClientId': this.config.clientId,
      },
    });

    // Add request interceptor to inject current access token
    this.httpClient.interceptors.request.use((config) => {
      if (this.config.accessToken) {
        config.headers.Authorization = `Bearer ${this.config.accessToken}`;
      }
      // Add profile ID as Scope header if provided
      if (this.config.profileId) {
        config.headers['Amazon-Advertising-API-Scope'] = this.config.profileId;
      }
      return config;
    });

    // Add response interceptor for automatic token refresh on 401
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        // If 401 and we have refresh token, try to refresh
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.config.refreshToken &&
          this.config.clientSecret
        ) {
          originalRequest._retry = true;

          try {
            // Refresh the token
            const newAccessToken = await this.refreshAccessToken();

            // Update the failed request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }

            // Retry the original request
            return this.httpClient(originalRequest);
          } catch (refreshError) {
            // Token refresh failed, reject with original error
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Refresh the access token using the refresh token
   * Handles concurrent refresh requests to avoid race conditions
   */
  private async refreshAccessToken(): Promise<string> {
    // If already refreshing, wait for that promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start refresh process
    this.isRefreshing = true;
    this.refreshPromise = this._doRefresh();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform the actual token refresh
   */
  private async _doRefresh(): Promise<string> {
    if (!this.config.refreshToken || !this.config.clientSecret) {
      throw new Error('Missing refresh token or client secret for token refresh');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await axios.post<LwaTokenResponse>(
        this.LWA_TOKEN_URL,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in, refresh_token } = response.data;

      // Update config with new token
      this.config.accessToken = access_token;

      // Update refresh token if a new one was provided
      if (refresh_token) {
        this.config.refreshToken = refresh_token;
      }

      // Notify callback if provided (for persisting to storage)
      if (this.config.onTokenRefresh) {
        await this.config.onTokenRefresh(access_token, expires_in);
      }

      return access_token;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `Token refresh failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      }
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Manually trigger a token refresh
   * Useful for proactively refreshing tokens before expiry
   */
  public async forceRefreshToken(): Promise<void> {
    await this.refreshAccessToken();
  }

  public async getProfiles() {
    // Note: Profiles endpoint might have a different base URL or headers.
    // Check Amazon Advertising API documentation specifically for GET /profiles.
    // Profiles call does not require Scope (profile id) header; omit it here.
    return this.httpClient.get(`/v2/profiles`);
  }
}
