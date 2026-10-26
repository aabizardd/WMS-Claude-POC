import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function MaterialTypesPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'Type',
        endpoint: '/material-types',
        permission: 'material-types',
        codeKey: 'materialTypeCode',
        nameKey: 'materialTypeName',
        codeLabel: 'Type Code',
        nameLabel: 'Material Type Name',
        addLabel: 'Add Type',
        codePlaceholder: 'MATTYPE-001',
        withDescription: true,
      }}
    />
  );
}
