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

  // Disabled buttons swallow pointer events, so a native `title` never shows.
  // Wrap them in a tooltip trigger so the explanatory text stays reachable.
  const withDisabledTooltip = (node: React.ReactNode) => {
    if (!props.disabled || !props.title) return node;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{node}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">{props.title}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Admin users always have access
  if (isAdmin) {
    return withDisabledTooltip(
      <Button {...props} onClick={onClick}>
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

  return withDisabledTooltip(
    <Button {...props} onClick={onClick}>
      {children}
    </Button>
  );
}

