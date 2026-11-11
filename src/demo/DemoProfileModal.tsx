import { Modal } from '@/components/ui/Modal';
import { DemoProfileList } from './DemoProfileList';

export function DemoProfileModal({
  open,
  currentId,
  onSelect,
  onClose,
}: {
  open: boolean;
  currentId: string | null;
  onSelect: (personId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Trocar perfil de demonstração" description="Escolha quem você quer ser nesta demonstração.">
      <DemoProfileList currentId={currentId} onSelect={onSelect} />
    </Modal>
  );
}
