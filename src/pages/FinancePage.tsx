import { Wallet } from 'lucide-react';
import { ComingSoon } from '@/components/ui/ComingSoon';

export default function FinancePage() {
  return (
    <ComingSoon
      module="finance"
      title="Financeiro"
      icon={Wallet}
      planned={[
        'Lançamentos de receitas e despesas por loja',
        'Visão consolidada de todas as lojas para o administrador geral',
        'Fechamentos e relatórios por período',
        'Exportação de dados, conforme a permissão “Exportar”',
      ]}
    />
  );
}
