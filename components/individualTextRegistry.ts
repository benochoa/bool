import VoelkName from '../Data/People/Voelk/Text/name.json';
import VoelkQA from '../Data/People/Voelk/Text/qa.json';

import OchoName from '../Data/People/Ocho/Text/name.json';
import OchoQA from '../Data/People/Ocho/Text/qa.json';

import BoolterName from '../Data/People/Boolter/Text/name.json';
import BoolterQA from '../Data/People/Boolter/Text/qa.json';

import TolsmaName from '../Data/People/Tolsma/Text/name.json';
import TolsmaQA from '../Data/People/Tolsma/Text/qa.json';

import EmilioName from '../Data/People/Emilio/Text/name.json';
import EmilioQA from '../Data/People/Emilio/Text/qa.json';

import BrandoName from '../Data/People/Brando/Text/name.json';
import BrandoQA from '../Data/People/Brando/Text/qa.json';

// Registry of all individual text data
const individualTextRegistry: Record<string, {
  name: string;
  qa: { question: string; answer: string }[];
}> = {

  'Data/People/Voelk': {
    name: VoelkName,
    qa: VoelkQA,
  },

  'Data/People/Ocho': {
    name: OchoName,
    qa: OchoQA,
  },

  'Data/People/Boolter': {
    name: BoolterName,
    qa: BoolterQA,
  },

  'Data/People/Tolsma': {
    name: TolsmaName,
    qa: TolsmaQA,
  },

  'Data/People/Emilio': {
    name: EmilioName,
    qa: EmilioQA,
  },

  'Data/People/Brando': {
    name: BrandoName,
    qa: BrandoQA,
  },

};

export default individualTextRegistry;
