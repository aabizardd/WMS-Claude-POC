import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function UomsPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'UoM',
        endpoint: '/uoms',
        permission: 'uoms',
        codeKey: 'uomCode',
        nameKey: 'uomName',
        codeLabel: 'UoM Code',
        nameLabel: 'UoM Name',
        addLabel: 'Add UoM',
        codePlaceholder: 'pcs',
        namePlaceholder: 'Pieces',
        withAllowsDecimal: true,
      }}
    />
  );
}
