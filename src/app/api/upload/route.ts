import { NextRequest, NextResponse } from 'next/server';
import { ownerRoute, coreError } from '@/lib/personal/core-api';
import { getPersonalConfig } from '@/lib/config/runtime';
import crypto from 'crypto';
import { getVisionSafetyProvider } from '@/lib/ai/vision-safety-provider';
import { getObjectStore } from '@/lib/storage/object-store';
import { approveUpload } from '@/lib/storage/approved-upload';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// POST: 用户上传图片（先内容安全审核，通过后保存到 ObjectStore）
export async function POST(request: NextRequest) {
  return ownerRoute(request, async (visitorId) => {
    try {
      if (!getPersonalConfig(process.env,{strict:false}).capabilities.upload.enabled)
        return coreError(503, 'FEATURE_NOT_CONFIGURED');

      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return apiError(400, 'MISSING_IMAGE', '请选择图片');
      }
      const ext = ALLOWED_TYPES[file.type];
      if (!ext) {
        return apiError(400, 'UNSUPPORTED_IMAGE_TYPE', '只支持 JPG/PNG/WebP/GIF 图片');
      }
      if (file.size > MAX_SIZE) {
        return apiError(400, 'IMAGE_TOO_LARGE', '图片不能超过 10MB');
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      // 审核 provider 超时、空响应或 schema 异常会抛错并进入 500，绝不放行。
      const review = await getVisionSafetyProvider().inspect({
        image: { bytes: buffer, mediaType: file.type },
      });
      if (!review.safe) {
        return apiError(
          400,
          'IMAGE_SAFETY_REJECTED',
          `图片未通过安全审核${review.reason ? `：${review.reason}` : ''}，换一张试试吧`,
        );
      }

      const filename = `${crypto.randomUUID()}.${ext}`;

      const key = `uploads/${visitorId}/${filename}`;
      const stored = await getObjectStore().put({
        key,
        bytes: buffer,
        mediaType: file.type,
      });
      return NextResponse.json({ path: approveUpload(visitorId, key, stored.url) });
    } catch (err) {
      console.error('[upload:POST]', err instanceof Error ? err.name : 'unknown');
      return apiError(500, 'UPLOAD_FAILED', '图片上传失败，请稍后再试');
    }
  });
}
