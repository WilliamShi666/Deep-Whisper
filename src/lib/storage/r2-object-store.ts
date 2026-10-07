import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ObjectStore } from '@/lib/ai';

type R2EnvName =
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_ENDPOINT'
  | 'R2_BUCKET_NAME'
  | 'R2_PUBLIC_URL';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const R2_ENV_NAMES: R2EnvName[] = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
];

function requireEnv(env: RuntimeEnvironment, name: R2EnvName): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function isR2Configured(env: RuntimeEnvironment = process.env): boolean {
  return R2_ENV_NAMES.every((name) => Boolean(env[name]?.trim()));
}

export function createR2ObjectStore(
  env: RuntimeEnvironment = process.env,
): ObjectStore {
  const endpoint = requireEnv(env, 'R2_ENDPOINT');
  const bucket = requireEnv(env, 'R2_BUCKET_NAME');
  const publicUrl = requireEnv(env, 'R2_PUBLIC_URL').replace(/\/+$/, '');
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: requireEnv(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(env, 'R2_SECRET_ACCESS_KEY'),
    },
  });

  return {
    async put(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.bytes,
          ContentType: input.mediaType,
          CacheControl: input.cacheControl,
        }),
      );
      return { key: input.key, url: `${publicUrl}/${input.key}` };
    },
  };
}
