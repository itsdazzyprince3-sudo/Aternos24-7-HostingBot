'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const minecraftData = require('minecraft-data')
const protocol = minecraftData('26.3').protocol
const components = protocol.types.SlotComponentType[1].mappings
const switchFields = protocol.types.SlotComponent[1][1].type[1].fields

test('26.3 uses the official item-component registry order', () => {
  assert.equal(components[40], 'attack_animation')
  assert.equal(components[41], 'interact_animation')
  assert.equal(components[43], 'block_transformer')
  assert.equal(components[44], 'villager_food')
  assert.equal(components[80], 'sulfur_cube_content')
  assert.equal(components[84], 'compostable')
  assert.equal(components[85], 'cooking_fuel')
  assert.equal(components[86], 'brewing_fuel')
  assert.equal(components[87], 'mob_visibility')
  assert.equal(components[117], 'provides_pottery_pattern')
  assert.equal(components[118], 'sign_text_front')
  assert.equal(components[119], 'sign_text_back')
  assert.equal(components[120], 'waxed')
  assert.equal(components[121], 'cushion/color')
  assert.ok(!Object.values(components).includes('swing_animation'))
  assert.ok(!Object.values(components).includes('map_color'))
})

test('26.3 SlotComponent switch has split animation and new component codecs', () => {
  assert.deepEqual(switchFields.attack_animation, switchFields.interact_animation)
  assert.equal(switchFields.block_transformer, 'varint')
  assert.equal(switchFields.villager_food, 'varint')
  assert.equal(switchFields.sulfur_cube_content, 'ItemStackTemplate')
  assert.deepEqual(switchFields.compostable, [
    'container',
    [
      { name: 'isReference', type: 'bool' },
      { name: 'value', type: ['switch', { compareTo: 'isReference', fields: { true: 'string', false: 'i32' } }] }
    ]
  ])
  assert.equal(switchFields.cooking_fuel[1][0].name, 'burnTime')
  assert.deepEqual(switchFields.cooking_fuel[1][0].type, switchFields.compostable)
  assert.deepEqual(switchFields.cooking_fuel[1][1].type, [
    'container',
    [
      { name: 'isReference', type: 'bool' },
      { name: 'value', type: ['switch', { compareTo: 'isReference', fields: { true: 'string', false: 'f32' } }] }
    ]
  ])
  assert.equal(switchFields.brewing_fuel[1][0].name, 'uses')
  assert.deepEqual(switchFields.brewing_fuel[1][0].type, switchFields.compostable)
  assert.deepEqual(switchFields.mob_visibility, ['container', [
    { name: 'targetingEntityTypes', type: 'registryEntryHolderSet' },
    { name: 'visibility', type: 'f32' }
  ]])
  assert.equal(switchFields.sign_text_front[1][0].type[1][0].type, 'anonymousNbt')
  assert.equal(switchFields.sign_text_front[1][2].type, 'varint')
  assert.equal(switchFields.waxed, 'void')
  assert.equal(switchFields.cushion_color, 'DyeColor')
})
