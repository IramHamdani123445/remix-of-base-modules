/**
 * LiveVersionGuardDialog
 *
 * Shown when the user tries to edit, save, or delete an ACTIVE / PENDING /
 * RETIRED product version. Instead of silently disabling the button, we
 * explain *why* and offer guided next steps:
 *   - Create Draft Version  → clones the current configuration into a new DRAFT
 *   - View Current Version  → just closes the dialog (caller may navigate)
 *   - Retire Version        → only for ACTIVE versions that already have a replacement
 *
 * The dialog is mode-aware (edit vs delete) and status-aware so the copy
 * stays accurate across the version lifecycle.
 */
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
import { Button } from '@/components/ui/button';
import { Lock, FilePlus2, Eye, Archive } from 'lucide-react';
import { BnBusyButton } from '@/components/bn/shared';

export type LiveGuardIntent = 'EDIT' | 'DELETE';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: LiveGuardIntent;
  status: string;
  versionLabel: string;
  busy?: boolean;
  onCreateDraft: () => void;
  onViewCurrent?: () => void;
  onRetire?: () => void;
}

export function LiveVersionGuardDialog({
  open,
  onOpenChange,
  intent,
  status,
  versionLabel,
  busy,
  onCreateDraft,
  onViewCurrent,
  onRetire,
}: Props) {
  const isDelete = intent === 'DELETE';
  const isActive = status === 'ACTIVE';

  const title = isDelete
    ? 'Live Versions Cannot Be Deleted'
    : 'Create New Version to Make Changes';

  const message = isDelete
    ? `${versionLabel} is live and cannot be deleted. You may retire this version after another version is active, or create a replacement draft to introduce changes safely.`
    : `${versionLabel} is live and cannot be changed directly. Any change will create a new draft version so existing claims continue using the current rules.`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {onViewCurrent && (
            <BnBusyButton loading={busy} variant="outline" onClick={onViewCurrent} disabled={busy} className="gap-2">
              <Eye className="h-4 w-4" /> View Current Version
            </BnBusyButton>
          )}
          {isDelete && isActive && onRetire && (
            <BnBusyButton loading={busy} variant="outline" onClick={onRetire} disabled={busy} className="gap-2">
              <Archive className="h-4 w-4" /> Retire Version
            </BnBusyButton>
          )}
          <AlertDialogAction onClick={onCreateDraft} disabled={busy} className="gap-2">
            <FilePlus2 className="h-4 w-4" />
            {busy ? 'Creating…' : isDelete ? 'Create Replacement Draft' : 'Create Draft Version'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
