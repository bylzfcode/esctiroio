import { AllPeople } from '@/components/team/AllPeople';
import { StoreTeam } from '@/components/team/StoreTeam';
import { useSession } from '@/context/SessionContext';

export default function TeamPage() {
  const { scope, activeStore } = useSession();
  if (scope.kind === 'consolidated' || !activeStore) return <AllPeople />;
  return <StoreTeam store={activeStore} />;
}
