import { DSL } from '@shell/store/type-map';

export const NAME = 'suseStorage';

export async function init(store) {
  const { product, basicType, virtualType } = DSL(store, NAME);

  product({
    icon:        'longhorn',
    ifHaveType:  'longhorn.io.edition',
    ifHaveGroup: 'longhorn.io',
  });

  virtualType({
    label:      'Overview',
    group:      'Root',
    namespaced: false,
    name:       NAME,
    route:      { name: `c-cluster-${ NAME }` },
    exact:      true,
    overview:   true,
  });

  basicType(NAME);
}
