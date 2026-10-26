import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import MultiValueInput from '../components/MultiValueInput';

/** Wrapper that keeps the chips, so a test can read what the field holds. */
function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <MultiValueInput
      values={values}
      onChange={(v) => {
        setValues(v);
        onChange?.(v);
      }}
      placeholder="type here"
    />
  );
}

function paste(text: string) {
  const input = screen.getByPlaceholderText('type here');
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
  return input;
}

describe('MultiValueInput', () => {
  it('turns a pasted column of lines into one chip per line', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste('bin kit 01\nbin kit 02\nbin kit 03');
    expect(onChange).toHaveBeenCalledWith(['bin kit 01', 'bin kit 02', 'bin kit 03']);
  });

  it('handles Windows line endings, tabs and commas the same way', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste('a\r\nb\tc,d');
    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c', 'd']);
  });

  it('drops blank lines and trims each value', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste('  one  \n\n   \ntwo\n');
    expect(onChange).toHaveBeenCalledWith(['one', 'two']);
  });

  it('skips duplicates regardless of case', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste('KIT A1-01\nkit a1-01\nKIT A1-02');
    expect(onChange).toHaveBeenCalledWith(['KIT A1-01', 'KIT A1-02']);
  });

  it('leaves a plain word to normal typing instead of committing it', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste('justoneword');
    // No separator: the paste falls through to the browser, so no chip yet.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps what was already typed in front of the pasted list', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText('type here');
    fireEvent.change(input, { target: { value: 'first' } });
    paste('second\nthird');
    expect(onChange).toHaveBeenCalledWith(['first', 'second', 'third']);
  });

  it('never exceeds the value cap', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste(Array.from({ length: 15 }, (_, i) => `v${i}`).join('\n'));
    expect(onChange.mock.calls[0][0]).toHaveLength(10);
  });

  it('still commits on Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText('type here');
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['typed']);
  });
});
