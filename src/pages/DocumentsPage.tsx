import { Card } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { DocumentLibraryTable } from '../features/documents/DocumentLibraryTable.tsx';
import { documentService } from '../features/documents/documentsSession.ts';
import { ModeNotice } from '../features/documents/ModeNotice.tsx';
import { UploadPanel } from '../features/documents/UploadPanel.tsx';
import { CASE } from '../features/case/caseSession.ts';

export function DocumentsPage() {
  const server = documentService.mode === 'server';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={CASE.reference} title="Documents" description="Upload, review and download the case file: statements, exhibits, orders and notes." />
      <ModeNotice />
      <Card
        title="Upload documents"
        info={
          <>
            Drop several files at once or use <b>Browse files</b>. Each file is checked before it is accepted: the type must be supported, it must be within the size limit, and its contents
            must match its extension.
            <br />
            <br />
            {server ? (
              <>
                Files are sent in small pieces. If the connection drops or you pause, the upload continues from the last piece the server received — even after refreshing the page (add the
                same file again). A fingerprint (SHA-256) confirms the server received exactly the original file.
              </>
            ) : (
              <>Files are stored in this browser in small pieces; pausing or refreshing continues from the last stored piece. A fingerprint (SHA-256) confirms the stored copy is identical.</>
            )}
          </>
        }
      >
        <UploadPanel />
      </Card>
      <Card
        title="Case documents"
        info={
          <>
            After upload each document is <b>validated</b>, then <b>processed</b>, its text <b>extracted</b> and <b>indexed</b>. Validation is real. Processing, extraction and indexing are
            simulated in this prototype — there is no OCR or search-index service yet — and say so in each document’s history.
            <br />
            <br />
            Documents marked <b>Sample data</b> are made-up examples, not a real case. Downloads are checked against the original’s fingerprint.
          </>
        }
      >
        <DocumentLibraryTable />
      </Card>
    </div>
  );
}
