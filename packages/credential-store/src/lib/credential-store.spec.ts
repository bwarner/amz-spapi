import { credentialStore } from './credential-store';

describe('credentialStore', () => {
  it('should work', () => {
    expect(credentialStore()).toEqual('credential-store');
  });
});
