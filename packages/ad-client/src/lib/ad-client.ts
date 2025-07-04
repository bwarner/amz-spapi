// import * as ManagerAccount_prod_3p from '@farvisionllc/amazon-ads-generated/ManagerAccount_prod_3p.js';

import axios, { AxiosInstance } from 'axios';

export interface AmazonAdsClientConfig {
  clientId: string; // Your LwA Client ID
  accessToken?: string; // The current access token obtained via OAuth
  profileId?: string; // The Advertiser Profile ID you're managing
  marketplaceId: string; // e.g., 'ATVPDKIKX0DER'
  refreshToken?: string; // Optional: for internal refreshing if client handles it
  clientSecret?: string; // Optional: for internal refreshing if client handles it
}

export class AmazonAdsApiClient {
  private httpClient: AxiosInstance;
  private config: AmazonAdsClientConfig;
  private BASE_URL = 'https://advertising-api.amazon.com'; // Base URL for SP-API (differs by region for other APIs)

  constructor(config: AmazonAdsClientConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: this.BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Amazon-Advertising-API-ClientId': this.config.profileId, // REQUIRED for SP-API
        'Amazon-Advertising-API-Scope': this.config.marketplaceId, // REQUIRED for SP-API
        Authorization: `Bearer ${this.config.accessToken}`,
        'x-api-key': this.config.clientId, // Some Amazon APIs also require this alongside Authorization
      },
    });

    // this.httpClient.interceptors.response.use(
    //   (response) => response,
    //   async (error) => {
    //     const originalRequest = error.config;
    //     if (error.response?.status === 401 && !originalRequest._retry) {
    //       originalRequest._retry = true;
    //       // Implement token refresh logic here
    //       const newAccessToken = await this.refreshToken(); // You'd need to implement this method
    //       this.config.accessToken = newAccessToken;
    //       originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
    //       return this.httpClient(originalRequest);
    //     }
    //     return Promise.reject(error);
    //   }
    // );
  }

  public async getProfiles() //   AxiosResponse< // public async getProfiles(): Promise<
  //     ManagerAccount_prod_3p.components['schemas']['GetManagerAccountsResponse']
  //   >
  // > {
  {
    // Note: Profiles endpoint might have a different base URL or headers.
    // Check Amazon Advertising API documentation specifically for GET /profiles.
    // Sometimes it's without 'Amazon-Advertising-API-ClientId' and 'Scope'
    // This method would require a separate httpClient instance or modification of headers for just this call
    // return this.httpClient.get<
    // ManagerAccount_prod_3p.components['schemas']['GetManagerAccountsResponse']
    // >(`/v2/profiles`);
    return this.httpClient.get(`/v2/profiles`);
  }
}
