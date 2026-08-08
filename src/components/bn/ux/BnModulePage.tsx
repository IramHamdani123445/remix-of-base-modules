/**
 * BnModulePage / BnModuleHeader — the single page frame for Benefits modules.
 *
 * Every Benefits module screen (Means-Test, Fraud/Error & Risk, Uprating,
 * Overpayment Recovery) is built from this frame so that page padding, title
 * scale, description width, status badges, primary action placement and
 * breadcrumb position are identical across the product.
 *
 * Purely presentational: no business logic, no data access.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { LucideIcon } from 'lucide-react';

export interface BnModuleBadge {
  readonly label: string;
  readonly variant?: 'default' | 'secondary' | 'outline' | 'destructive';
  readonly testId?: string;
}

interface HeaderProps {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly badges?: readonly BnModuleBadge[];
  /** Primary and secondary actions, right aligned on wide screens. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export const BnModuleHeader: React.FC<HeaderProps> = ({
  icon: Icon,
  title,
  description,
  badges,
  actions,
  className,
}) => (
  <header
    className={cn('flex flex-col gap-4 md:flex-row md:items-start md:justify-between', className)}
    data-testid="bn-module-header"
  >
    <div className="flex min-w-0 items-start gap-3">
      {Icon && <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />}
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
        {description && (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
        {badges && badges.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {badges.map((badge) => (
              <Badge
                key={badge.label}
                variant={badge.variant ?? 'outline'}
                data-testid={badge.testId}
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
    {actions && (
      <div className="flex flex-wrap items-center gap-2 md:justify-end md:shrink-0">{actions}</div>
    )}
  </header>
);

interface PageProps {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

/** Consistent page padding and vertical rhythm for every Benefits screen. */
export const BnModulePage: React.FC<PageProps> = ({ children, className, testId }) => (
  <div className={cn('space-y-6 p-4 sm:p-6', className)} data-testid={testId ?? 'bn-module-page'}>
    {children}
  </div>
);

interface DisclosureProps {
  readonly summary: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
}

/**
 * Progressive disclosure for explanatory content. Guidance never competes with
 * the work: it is collapsed by default and rendered identically everywhere.
 */
export const BnModuleGuidance: React.FC<DisclosureProps> = ({ summary, children, defaultOpen }) => (
  <details
    className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
    open={defaultOpen}
    data-testid="bn-module-guidance"
  >
    <summary className="cursor-pointer font-medium text-foreground">{summary}</summary>
    <div className="max-w-3xl space-y-2 pt-2">{children}</div>
  </details>
);
