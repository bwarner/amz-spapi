'use client';

import { Clipboard } from 'lucide-react';
import { APLUS_GUIDANCE_MAX_LENGTH } from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Advanced-mode "guidance overlay": shows the REAL prompts the generator runs
 * (read-only) and lets the seller append bounded custom instructions per
 * phase. The prompts' compliance rules always take precedence over guidance —
 * users steer generation without being able to break the schema contracts.
 */
export function APlusGuidancePanel({
  strategyPromptPreview,
  moduleCopyRulesPreview,
  guidanceStrategy,
  guidanceModuleCopy,
  onGuidanceStrategyChange,
  onGuidanceModuleCopyChange,
  onCopyStrategyPrompt,
  strategyPromptCopied,
}: {
  strategyPromptPreview: string;
  moduleCopyRulesPreview: string;
  guidanceStrategy: string;
  guidanceModuleCopy: string;
  onGuidanceStrategyChange: (value: string) => void;
  onGuidanceModuleCopyChange: (value: string) => void;
  onCopyStrategyPrompt: () => void;
  strategyPromptCopied: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <h2 className="font-semibold">Generation guidance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the actual prompts SellAvant runs, in two phases: first a
          content strategy, then the module copy. Add your own instructions to
          steer either phase — compliance rules still take precedence.
        </p>
      </div>

      <section className="space-y-3 rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Phase 1 — Strategy</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Decides the buyer story and which Amazon modules to use, from your
              product facts, sources, and assets.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopyStrategyPrompt}
          >
            <Clipboard className="mr-2 h-4 w-4" />
            {strategyPromptCopied ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
        <pre className="max-h-[40vh] overflow-auto rounded-md border bg-muted p-4 text-xs leading-5">
          {strategyPromptPreview}
        </pre>
        <div className="space-y-2">
          <Label htmlFor="guidance-strategy">
            Your strategy instructions (optional)
          </Label>
          <Textarea
            id="guidance-strategy"
            value={guidanceStrategy}
            maxLength={APLUS_GUIDANCE_MAX_LENGTH}
            onChange={(event) => onGuidanceStrategyChange(event.target.value)}
            placeholder="e.g. Lead with the eco-friendly angle; skip the comparison table; the buyer is a small café owner."
            className="min-h-24"
          />
          <p className="text-xs text-muted-foreground">
            Appended to the strategy prompt above. {guidanceStrategy.length}/
            {APLUS_GUIDANCE_MAX_LENGTH}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-md border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">Phase 2 — Module copy</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Writes each module&apos;s customer-facing copy and image briefs
            under these fixed rules. Your product context, the module plan, and
            the shot bible are appended at generation time.
          </p>
        </div>
        <pre className="max-h-[40vh] overflow-auto rounded-md border bg-muted p-4 text-xs leading-5">
          {moduleCopyRulesPreview}
        </pre>
        <div className="space-y-2">
          <Label htmlFor="guidance-module-copy">
            Your copywriting instructions (optional)
          </Label>
          <Textarea
            id="guidance-module-copy"
            value={guidanceModuleCopy}
            maxLength={APLUS_GUIDANCE_MAX_LENGTH}
            onChange={(event) => onGuidanceModuleCopyChange(event.target.value)}
            placeholder="e.g. Punchier headlines; write for gift buyers; mention the 50-pack count in at least one module."
            className="min-h-24"
          />
          <p className="text-xs text-muted-foreground">
            Appended to every module-copy prompt. {guidanceModuleCopy.length}/
            {APLUS_GUIDANCE_MAX_LENGTH}
          </p>
        </div>
      </section>
    </div>
  );
}
