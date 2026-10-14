export async function loadOwnerSession(fetcher: typeof fetch = fetch): Promise<{
  status: 'authed' | 'guest' | 'error';
  accessMode?: 'local' | 'password';
}> {
  try {
    const response = await fetcher('/api/owner/session', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { status: 'error' };
    const data = await response.json();
    if (
      typeof data?.authenticated !== 'boolean' ||
      !['local', 'password'].includes(data.accessMode)
    )
      return { status: 'error' };
    return { status: data.authenticated ? 'authed' : 'guest', accessMode: data.accessMode };
  } catch {
    return { status: 'error' };
  }
}
