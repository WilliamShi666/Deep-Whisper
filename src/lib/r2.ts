import {
  createR2ObjectStore,
  isR2Configured,
} from '@/lib/storage/r2-object-store';

export { isR2Configured };

/**
 * 上传文件到 R2，返回永久的公开访问链接。
 *
 * @param fileBuffer  文件内容
 * @param fileName    存储桶内的对象键，例如 `images/xxxx.png`
 * @param contentType MIME 类型，例如 `image/png`
 */
export async function uploadToR2(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const stored = await createR2ObjectStore().put({
    key: fileName,
    bytes: fileBuffer,
    mediaType: contentType,
  });
  return stored.url;
}
