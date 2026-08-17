/**
 * Omni-Comms Print — registered equipment picker.
 *
 * Equipment is no longer typed by hand: the operator chooses a device that
 * exists in the tenant's print equipment register, so every physical attempt
 * can be traced back to a real, active machine. Operators who may configure
 * Omni-Comms can register a missing device without leaving the flow.
 */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import {
  describePrintEquipment,
  listPrintEquipment,
  upsertPrintEquipment,
  OMNI_COMMS_PRINT_DEVICE_TYPES,
  OMNI_COMMS_PRINT_DEVICE_TYPE_LABELS,
  type OmniCommsPrintDeviceType,
} from "@/platform/omni-comms/application/printEquipmentService";

export const PRINT_EQUIPMENT_QUERY_KEY = ["omni-comms", "print-equipment"];

export interface PrintEquipmentSelectProps {
  id?: string;
  /** Selected device code (the value recorded on the print attempt). */
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Print cannot be evidenced without a device, so this is required by default. */
  required?: boolean;
}

const NONE = "__none__";

export const PrintEquipmentSelect: React.FC<PrintEquipmentSelectProps> = ({
  id = "print-equipment",
  value,
  onChange,
  label = "Printer / equipment",
  required = true,
}) => {
  const { organizationId, departmentId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const queryClient = useQueryClient();

  const [registerOpen, setRegisterOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [deviceType, setDeviceType] =
    useState<OmniCommsPrintDeviceType>("printer");

  const equipment = useQuery({
    queryKey: [...PRINT_EQUIPMENT_QUERY_KEY, organizationId, departmentId],
    enabled: Boolean(organizationId),
    queryFn: () =>
      listPrintEquipment(client, {
        organizationId: organizationId as string,
        departmentId: departmentId ?? null,
      }),
  });

  const register = useMutation({
    mutationFn: () =>
      upsertPrintEquipment(client, {
        organizationId: organizationId as string,
        code,
        displayName: name,
        departmentId: departmentId ?? null,
        location: location || null,
        deviceType,
      }),
    onSuccess: (result) => {
      toast.success(`Registered ${result.code}.`);
      onChange(result.code);
      setRegisterOpen(false);
      setCode("");
      setName("");
      setLocation("");
      void queryClient.invalidateQueries({ queryKey: PRINT_EQUIPMENT_QUERY_KEY });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Could not register the device.",
      ),
  });

  const items = equipment.data?.items ?? [];
  const canManage = equipment.data?.manage_permitted ?? false;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label} {required ? "" : "(optional)"}
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={value || NONE}
          onValueChange={(next) => onChange(next === NONE ? "" : next)}
        >
          <SelectTrigger id={id} data-testid="print-equipment-select">
            <SelectValue
              placeholder={
                equipment.isLoading ? "Loading devices…" : "Select a device"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {!required && <SelectItem value={NONE}>Not recorded</SelectItem>}
            {items.map((row) => (
              <SelectItem key={row.id} value={row.code}>
                {describePrintEquipment(row)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            title="Register a device"
            onClick={() => setRegisterOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {!equipment.isLoading && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No active device is registered for this organisation.{" "}
          {canManage
            ? "Register the print-room printer before recording a physical print."
            : "Ask an Omni-Comms administrator to register the print-room printer."}
        </p>
      )}

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Register printing equipment</DialogTitle>
            <DialogDescription>
              The device code is recorded on every physical print attempt made
              on this machine.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="equipment-code">Device code</Label>
              <Input
                id="equipment-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="HQ-PRN-02"
              />
            </div>
            <div>
              <Label htmlFor="equipment-name">Name</Label>
              <Input
                id="equipment-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Benefits print room printer"
              />
            </div>
            <div>
              <Label htmlFor="equipment-location">Location (optional)</Label>
              <Input
                id="equipment-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Head office, 2nd floor"
              />
            </div>
            <div>
              <Label htmlFor="equipment-type">Device type</Label>
              <Select
                value={deviceType}
                onValueChange={(next) =>
                  setDeviceType(next as OmniCommsPrintDeviceType)
                }
              >
                <SelectTrigger id="equipment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OMNI_COMMS_PRINT_DEVICE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {OMNI_COMMS_PRINT_DEVICE_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                register.isPending ||
                code.trim().length === 0 ||
                name.trim().length === 0
              }
              onClick={() => register.mutate()}
            >
              Register device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrintEquipmentSelect;
