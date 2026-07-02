import Group1Name from '../Data/Groups/Group-1/Text/name.json';
import Group1QA from '../Data/Groups/Group-1/Text/qa.json';
import Group1Members from '../Data/Groups/Group-1/Text/members.json';

import Group2Name from '../Data/Groups/Group-2/Text/name.json';
import Group2QA from '../Data/Groups/Group-2/Text/qa.json';
import Group2Members from '../Data/Groups/Group-2/Text/members.json';

// Registry of all group text data
const groupTextRegistry: Record<string, {
  name: string;
  qa: { question: string; answer: string }[];
  members: string[];
}> = {

  'Data/Groups/Group-1': {
    name: Group1Name,
    qa: Group1QA,
    members: Group1Members,
  },

  'Data/Groups/Group-2': {
    name: Group2Name,
    qa: Group2QA,
    members: Group2Members,
  },

};

export default groupTextRegistry;
