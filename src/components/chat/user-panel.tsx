'use client';

/** Fixed owner status; password mode can lock this browser after confirmation. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n-client';
import { toast } from 'sonner';

export function UserPanel() {
  const router = useRouter();
  const { status, accessMode, signOut, refresh } = useAuth();
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (status === 'loading') {
    return <div className="h-9 animate-pulse rounded-md bg-muted/50" />;
  }

  if (status === 'error')
    return (
      <Button variant="ghost" onClick={() => void refresh()}>
        {t('chat.boot.retry')}
      </Button>
    );

  if (status === 'guest') {
    return (
      <div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => router.push('/login')}
        >
          <LogIn className="size-4" />
          <span className="truncate">{t('chat.user.sign_in')}</span>
        </Button>
      </div>
    );
  }

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/login');
    } catch {
      toast.error(t('chat.user.sign_out_failed'));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <UserRound className="size-4" />
        </div>
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={t('chat.user.owner')}
        >
          {t('chat.user.owner')}
        </span>
        {accessMode === 'password' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('chat.user.sign_out')}
            title={t('chat.user.sign_out')}
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <LogOut className="size-4" />
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.user.sign_out_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('chat.user.sign_out_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>
              {t('chat.user.sign_out_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? t('chat.user.signing_out') : t('chat.user.sign_out')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
