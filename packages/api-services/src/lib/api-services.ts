import axios from 'axios';
import { Product } from '@farvisionllc/models';

export class AmazonSPAPI {
  private readonly baseURL = 'https://sellingpartnerapi-na.amazon.com';

  constructor(private accessToken: string) {}

  async getProducts(): Promise<Product[]> {
    const response = await axios.get(`${this.baseURL}/products`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return response.data;
  }
}
