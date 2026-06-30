import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function AislesPage() {
  return (
    <SimpleMasterPage
      config={{
        title: 'Aisles',
        subtitle: 'Master data of warehouse aisles.',
        endpoint: '/aisles',
        permission: 'aisles',
        codeKey: 'aisleCode',
        nameKey: 'aisleName',
        codeLabel: 'Code',
        nameLabel: 'Name',
        addLabel: '+ Add Aisle',
      }}
    />
  );
}
