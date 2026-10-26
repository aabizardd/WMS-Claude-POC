import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function ShelvesPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'Shelf',
        endpoint: '/shelves',
        permission: 'shelves',
        codeKey: 'shelfCode',
        nameKey: 'shelfLabel',
        codeLabel: 'Shelf Code',
        nameLabel: 'Shelf Label',
        addLabel: 'Add Shelf',
        countKey: 'bins',
      }}
    />
  );
}
