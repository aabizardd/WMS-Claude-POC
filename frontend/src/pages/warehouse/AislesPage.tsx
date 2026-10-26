import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function AislesPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'Aisle',
        endpoint: '/aisles',
        permission: 'aisles',
        codeKey: 'aisleCode',
        nameKey: 'aisleName',
        codeLabel: 'Aisle ID',
        nameLabel: 'Aisle Name',
        addLabel: 'Add Aisle',
        countKey: 'bins',
      }}
    />
  );
}
