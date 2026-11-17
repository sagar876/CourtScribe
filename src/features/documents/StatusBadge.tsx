import { STATUS_INFO, type DocumentStatus } from '../../../shared/documents.ts';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';

const TONE: Record<DocumentStatus, Tone> = {
  uploaded: 'info',
  validating: 'info',
  processing: 'info',
  extracting: 'info',
  indexing: 'info',
  available: 'success',
  failed: 'danger',
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={TONE[status]} title={STATUS_INFO[status].description}>
      {status !== 'available' && status !== 'failed' && <span aria-hidden="true">⟳</span>}
      {STATUS_INFO[status].label}
    </Badge>
  );
}
