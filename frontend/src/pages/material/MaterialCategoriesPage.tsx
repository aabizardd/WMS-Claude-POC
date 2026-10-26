import SimpleMasterPage from '../../components/SimpleMasterPage';

export default function MaterialCategoriesPage() {
  return (
    <SimpleMasterPage
      config={{
        noun: 'Category',
        endpoint: '/material-categories',
        permission: 'material-categories',
        codeKey: 'materialCategoryCode',
        nameKey: 'materialCategoryName',
        codeLabel: 'Category Code',
        nameLabel: 'Material Category Name',
        addLabel: 'Add Category',
        codePlaceholder: 'CAT-001',
        withDescription: true,
      }}
    />
  );
}
