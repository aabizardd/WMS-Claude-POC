import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function AreaTypesPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'Area',
        endpoint: '/area-types',
        permission: 'area-types',
        codeKey: 'areaTypeCode',
        nameKey: 'areaTypeName',
        codeLabel: 'Area ID',
        nameLabel: 'Area Name',
        addLabel: 'Add Area',
        countKey: 'bins',
      }}
    />
  );
}
