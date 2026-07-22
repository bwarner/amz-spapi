'use client';

import { ShieldAlert } from 'lucide-react';
import {
  applyAPlusGuardrails,
  type APlusModuleTextFieldDescriptor,
  type APlusTextFieldPath,
} from '@farvisionllc/models';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * One editable text field driven by a descriptor (module- or section-level):
 * input/textarea bound to the descriptor path, with a guardrail lint badge
 * when the text contains Amazon-prohibited claims (the preview strips them
 * until fixed — the text itself is never mutated or blocked).
 */
export function EditableTextField({
  field,
  onEdit,
}: {
  field: APlusModuleTextFieldDescriptor;
  onEdit: (path: APlusTextFieldPath, value: string) => void;
}) {
  const triggered = field.value
    ? applyAPlusGuardrails(field.value).triggered
    : [];

  return (
    <div
      className={cn(
        'space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm',
        field.multiline ? 'md:col-span-2' : ''
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {field.label}
        </p>
        <span className="text-[10px] text-muted-foreground">
          {field.value.length}/{field.maxLength}
        </span>
      </div>
      {field.multiline ? (
        <Textarea
          value={field.value}
          maxLength={field.maxLength}
          onChange={(event) => onEdit(field.path, event.target.value)}
          aria-label={field.label}
          className="min-h-20 bg-background"
        />
      ) : (
        <Input
          value={field.value}
          maxLength={field.maxLength}
          onChange={(event) => onEdit(field.path, event.target.value)}
          aria-label={field.label}
          className="bg-background"
        />
      )}
      {triggered.length ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {triggered.join('; ')} — this text is hidden from the preview and
            build sheet until fixed (Amazon rejects these claims).
          </span>
        </p>
      ) : null}
    </div>
  );
}
