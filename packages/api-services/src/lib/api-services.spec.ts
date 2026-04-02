import { AmazonSPAPI } from './api-services';

describe('AmazonSPAPI', () => {
  it('should create an instance with access token', () => {
    const api = new AmazonSPAPI('test-token');
    expect(api).toBeInstanceOf(AmazonSPAPI);
  });
});
