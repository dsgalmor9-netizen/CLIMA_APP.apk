import {
  runCheckExpiredDevicesCron,
  verifyCronSecretHeader,
} from '../../../../src/server/cronCheckExpired';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleCronRequest(request: Request): Promise<Response> {
  const authCheck = verifyCronSecretHeader({
    authorization: request.headers.get('authorization'),
    cronSecretHeader: request.headers.get('x-cron-secret'),
  });

  if (!authCheck.ok) {
    return Response.json(
      {
        ok: false,
        errorCode: authCheck.errorCode,
        errorMessage: authCheck.errorMessage,
      },
      { status: authCheck.statusCode }
    );
  }

  try {
    const result = await runCheckExpiredDevicesCron();
    return Response.json(result, { status: result.statusCode });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        errorCode: 'CRON_EXECUTION_ERROR',
        errorMessage:
          err instanceof Error ? err.message : 'Error al ejecutar verificación de dispositivos.',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleCronRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCronRequest(request);
}
