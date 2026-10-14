import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Product mark; companion portraits remain specific to each character. */
export function BrandLogo({ className, decorative = false, priority = false }: {
  className?: string;
  decorative?: boolean;
  priority?: boolean;
}) {
  return <Image src="/brand/logo.png" alt={decorative ? '' : 'Deep Whisper'}
    width={256} height={256} sizes="(max-width: 640px) 96px, 128px"
    priority={priority} className={cn('size-10 shrink-0 object-contain', className)} />;
}
