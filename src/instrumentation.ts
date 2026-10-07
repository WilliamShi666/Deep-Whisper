export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DW_INSTANCE_TOKEN) {
    const { getPersonalConfig } = await import('./lib/config/runtime');
    const { registerInstanceProcess, watchInstanceOwnership } = await import('./lib/personal/instance-lock');
    const config = getPersonalConfig(process.env, { strict: false });
    await registerInstanceProcess(config.dataDir, 'web-server');
    watchInstanceOwnership(config.dataDir);
  }
}
