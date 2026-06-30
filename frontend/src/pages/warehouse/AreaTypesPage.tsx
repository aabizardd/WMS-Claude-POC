import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function AreaTypesPage() {
  return (
    <SimpleMasterPage
      config={{
        title: 'Area Types',
        subtitle: 'Master data of warehouse area types.',
        endpoint: '/area-types',
        permission: 'area-types',
        codeKey: 'areaTypeCode',
        nameKey: 'areaTypeName',
        codeLabel: 'Code',
        nameLabel: 'Name',
        addLabel: '+ Add Area Type',
      }}
    />
  );
}
