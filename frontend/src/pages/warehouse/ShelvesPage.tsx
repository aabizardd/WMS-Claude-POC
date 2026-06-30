import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function ShelvesPage() {
  return (
    <SimpleMasterPage
      config={{
        title: 'Shelves',
        subtitle: 'Master data of warehouse shelves.',
        endpoint: '/shelves',
        permission: 'shelves',
        codeKey: 'shelfCode',
        nameKey: 'shelfLabel',
        codeLabel: 'Code',
        nameLabel: 'Label',
        addLabel: '+ Add Shelf',
      }}
    />
  );
}
