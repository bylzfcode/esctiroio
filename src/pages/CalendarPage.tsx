import { CalendarDays } from 'lucide-react';
import { ComingSoon } from '@/components/ui/ComingSoon';

export default function CalendarPage() {
  return (
    <ComingSoon
      module="calendar"
      title="Calendário"
      icon={CalendarDays}
      planned={[
        'Agenda de compromissos por loja',
        'Escalas e prazos da equipe',
        'Visão consolidada de datas importantes para o administrador geral',
      ]}
    />
  );
}
