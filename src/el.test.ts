import { el, serializeEl } from './el'

test('the serializer escapes text and attributes, and drops unset ones', () => {
  expect(
    serializeEl(
      el(
        'g',
        { class: 'a"b', title: undefined },
        el('text', { x: 1 }, 'AMY1A <&> x'),
        false,
        undefined,
      ),
    ),
  ).toBe('<g class="a&quot;b"><text x="1">AMY1A &lt;&amp;&gt; x</text></g>')
})
