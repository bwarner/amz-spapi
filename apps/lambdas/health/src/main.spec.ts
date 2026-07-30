import { buildHealthResponse, handler } from './main.js';

describe('health lambda', () => {
  const at = new Date('2026-07-30T12:00:00.000Z');

  it('reports the service and stage it was deployed as', () => {
    const response = buildHealthResponse(
      { SERVICE_NAME: 'health', STAGE: 'staging' },
      { awsRequestId: 'req-1' },
      at
    );

    expect(response).toEqual({
      status: 'ok',
      service: 'health',
      stage: 'staging',
      requestId: 'req-1',
      at: '2026-07-30T12:00:00.000Z',
    });
  });

  it('still answers when the environment says nothing', () => {
    // `sam local invoke` supplies neither, and the point of this function is to
    // answer in exactly the situations where something is misconfigured.
    const response = buildHealthResponse({}, undefined, at);

    expect(response.status).toBe('ok');
    expect(response.stage).toBe('dev');
    expect(response.requestId).toBeUndefined();
  });

  it('returns a JSON HTTP response', async () => {
    const result = await handler({}, { awsRequestId: 'req-2' });

    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('application/json');
    expect(JSON.parse(result.body)).toMatchObject({
      status: 'ok',
      requestId: 'req-2',
    });
  });
});
