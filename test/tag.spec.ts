import { first} from 'rxjs/operators'
import { AnyProposal, Arc, ContributionRewardProposal, DAO, Proposal, Tag } from '../src'
import { createAProposal, getTestDAO, newArc } from './utils'

jest.setTimeout(20000)

/**
 * Tag test
 */
describe('Tag', () => {

  let arc: Arc
  let dao: DAO
  const tags = ['tag1', 'tag2', 'tag3']
  const moretags = ['tag3', 'tag4']

  beforeAll(async () => {
    arc = await newArc()
    dao = await getTestDAO()
  })

  it('Tag is instantiable', () => {
    const tag = new Tag(arc, '0x1234id')
    expect(tag).toBeInstanceOf(Tag)
    const tag2 = new Tag(arc, { id: '0x1234id', numberOfProposals: 2})
    expect(tag2).toBeInstanceOf(Tag)
  })

  it('Tags are saved on a proposal', async () => {
    const proposal = await createAProposal(dao, { tags })
    const proposalState = await (new ContributionRewardProposal(arc, proposal.id)).fetchState()
    expect(proposalState.tags).toEqual(tags)
  })

  it('proposals are searchable by tag', async () => {
    const proposal = await createAProposal(dao, { tags })
    const proposals = await Proposal.search(arc, { where: { tags_contains: ['tag1']}}).pipe(first()).toPromise()
    expect(proposals.map((p: AnyProposal) => p.id)).toContain(proposal.id)
  })

  it('Tags are searchable', async () => {
    let result: any
    await createAProposal(dao, { tags })
    await createAProposal(dao, { tags: moretags })

    result = await Tag
      .search(arc, {where:  {id: 'this tag does not exist'}})
      .pipe(first()).toPromise()
    expect(result).toEqual([])
    result = await Tag.search(arc, {where: {id: 'tag3'}})
      .pipe(first()).toPromise()
    expect(result.map((t: Tag) => t.id)).toEqual(['tag3'])
    const tag = result[0]
    expect(tag.coreState.numberOfProposals).toBeGreaterThanOrEqual(2)

  })

  it('arc.tags(..) works', async () => {
    await arc.tags().pipe(first()).toPromise()
  })

  it('paging and sorting works', async () => {
    await createAProposal(dao, { tags: moretags.concat(tags) })
    const ls1 = await Tag.search(arc, { first: 3, orderBy: 'id' }).pipe(first()).toPromise()
    expect(ls1.map((t: Tag) => t.id)).toEqual(['tag1', 'tag2', 'tag3'])

    const ls2 = await Tag.search(arc, { first: 2, skip: 2, orderBy: 'id' }).pipe(first()).toPromise()
    expect(ls2.map((t: Tag) => t.id)).toEqual(['tag3', 'tag4'])

    const ls3 = await Tag.search(arc, {  orderBy: 'id', orderDirection: 'desc'}).pipe(first()).toPromise()
    expect(ls3.map((t: Tag) => t.id)).toEqual(['tag4', 'tag3', 'tag2', 'tag1'])
  })

})
