import { expect, test } from 'vitest'

import { FIGURE_DEFAULTS, figureSpecSettings } from './figureSettings'
import { ENGINE_DEFAULTS, engineSettingsOf } from './pipeline'

test('an absent setting reads as its default', () => {
  expect(engineSettingsOf()).toEqual(ENGINE_DEFAULTS)
  expect(engineSettingsOf({ quality: 4 })).toMatchObject({
    quality: 4,
    linearLayout: false,
    engine: 'fmmm',
  })
})

test('an explicit undefined does not turn a default off', () => {
  expect(engineSettingsOf({ showDeletionEdges: undefined })).toMatchObject({
    showDeletionEdges: true,
  })
  expect(engineSettingsOf({ showDeletionEdges: false })).toMatchObject({
    showDeletionEdges: false,
  })
})

test('a spec names only what differs from the default', () => {
  expect(figureSpecSettings(FIGURE_DEFAULTS)).toEqual({})
  expect(
    figureSpecSettings({
      quality: 2,
      colorScheme: 'depth',
      contigThickness: 6,
      connectorThickness: 5,
      showDeletionEdges: false,
    }),
  ).toEqual({
    colorScheme: 'depth',
    connectorThickness: 5,
    showDeletionEdges: false,
  })
})

test('a colour domain is a value, not a default', () => {
  const domain = { start: 10, end: 20 }
  expect(figureSpecSettings({ colorDomain: domain })).toEqual({
    colorDomain: domain,
  })
  expect(figureSpecSettings({ colorDomain: undefined })).toEqual({})
})
