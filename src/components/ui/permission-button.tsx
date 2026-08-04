import { useHasPermission, useIsAdmin } from "@/hooks/useNavigationMenu";
import { Button, ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PermissionButtonProps extends ButtonProps {
  moduleName: string;
  actionName: string;
  hideWhenDisabled?: boolean;
  children: React.ReactNode;
}

/**
 * A button that checks permissions before allowing actions.
 * Admin users always have full access.
 * If user doesn't have permission, button is disabled or hidden.
 */
export function PermissionButton({
  moduleName,
  actionName,
  hideWhenDisabled = false,
  children,
  onClick,
  ...props
}: PermissionButtonProps) {
  const isAdmin = useIsAdmin();
  const hasPermission = useHasPermission(moduleName, actionName);

  // Always render explanatory text through the shared tooltip (never the native
  // browser `title` bubble) so every button on a page looks consistent, and so
  // disabled buttons — which swallow pointer events — still surface their hint.
  const withTooltip = (node: React.ReactNode) => {
    if (!props.title) return node;
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{node}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-xs">
            <p>{props.title}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };


  // Admin users always have access
  if (isAdmin) {
    return withTooltip(
      <Button {...props} title={undefined} onClick={onClick}>
        {children}
      </Button>
    );
  }

  if (hideWhenDisabled && !hasPermission) {
    return null;
  }

  if (!hasPermission) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button {...props} disabled>
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>You don't have permission to perform this action</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return withTooltip(
    <Button {...props} title={undefined} onClick={onClick}>
      {children}
    </Button>
  );
}

