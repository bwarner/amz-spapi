import { APlusEditor } from '../aplus-editor';

export default async function APlusEditDesignPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <APlusEditor initialDraftId={draftId} />;
}
