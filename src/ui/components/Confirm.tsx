import { AlertDialog, Button } from '@heroui/react';
import { usePrefs } from '../usePrefs.ts';

// A question before something that can't be undone; the buttons answer it.
export function Confirm(props: { title: string; text: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = usePrefs();
  return (
    <AlertDialog.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{props.title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="m-0">{props.text}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" onPress={props.onClose}>
              {t.cancel}
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                props.onClose();
                props.onConfirm();
              }}
            >
              {props.confirm}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
