import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { FormSelectControl, FormSelectOption } from '~/common/components/forms/FormSelectControl';
import { useUIPreferencesStore } from '~/common/stores/store-ui';
import { DesignMateFeatures } from '~/modules/designmate/config';

const QuickOptions: FormSelectOption<'off' | 'call' | 'beam'>[] = [
  ...(DesignMateFeatures.beam ? [{ value: 'beam', label: 'Beam', description: 'Beam it' } satisfies FormSelectOption<'beam'>] : []),
  ...(DesignMateFeatures.call ? [{ value: 'call', label: 'Call', description: 'Call Persona' } satisfies FormSelectOption<'call'>] : []),
  { value: 'off', label: 'Off', description: 'Hide' },
];

export function SettingUIComposerQuickButton(props: { noLabel?: boolean }) {

  // external state
  const [composerQuickButton, setComposerQuickButton] = useUIPreferencesStore(useShallow(state => [state.composerQuickButton, state.setComposerQuickButton]));

  return (
    <FormSelectControl
      title={props.noLabel ? undefined : 'Quick Button'}
      options={QuickOptions}
      value={composerQuickButton}
      onChange={setComposerQuickButton}
      selectSx={{ minWidth: 150 }}
    />
  );
}
