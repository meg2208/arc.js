import BN = require('bn.js')
import gql from 'graphql-tag'
import { Observable } from 'rxjs'
import { first, map } from 'rxjs/operators'
import { Arc } from '../arc'
import { DAO } from '../dao'
import { mapGenesisProtocolParams } from '../genesisProtocol'
import { IApolloQueryOptions } from '../graphnode'
import { Operation, toIOperationObservable } from '../operation'
import { IProposalBaseCreateOptions, IProposalQueryOptions, Proposal } from '../proposal'
// import { IContributionRewardExtParams } from '../scheme'
import { Address } from '../types'
import { concat,
  createGraphQlQuery, dateToSecondsSinceEpoch, hexStringToUint8Array, isAddress, NULL_ADDRESS,
  secondSinceEpochToDate
} from '../utils'
import {  ISchemeState, SchemeBase } from './base'
// import { IProposalCreateOptionsContributionRewardExt} from './contributionRewardExt'

const Web3 = require('web3')

export interface ICompetitionProposal {
  id: string
  contract: Address
  endTime: Date
  numberOfWinners: number
  startTime: Date
  votingStartTime: Date
  suggestionsEndTime: Date
  numberOfVotesPerVoter: number
  snapshotBlock: number
  createdAt: Date,
 }

export interface IProposalCreateOptionsCompetition extends IProposalBaseCreateOptions {
  // beneficiary: Address
  endTime: Date,
  reputationReward ?: BN
  ethReward ?: BN
  externalTokenReward ?: BN
  externalTokenAddress ?: Address
  // proposer: Address,
  rewardSplit: number[]
  nativeTokenReward ?: BN
  numberOfVotesPerVoter: number
  startTime: Date,
  suggestionsEndTime: Date,
  votingStartTime: Date,
}

export interface ICompetitionSuggestion {
  id: string
  suggestionId: number
  proposal: string
  descriptionHash: string
  title?: string
  description?: string
  url?: string
  // fulltext: [string]
  suggester: Address
  // votes: [CompetitionVote!] @derivedFrom(field: "suggestion")
  totalVotes: BN
  createdAt: Date
  redeemedAt: Date
  rewardPercentage: number
}

export interface ICompetitionVote {
  id?: string
  // proposal: CompetitionProposal!
  // suggestion: CompetitionSuggestion!
  voter: Address
  createdAt?: Date
  reputation: BN
}

// export enum IProposalType {
//   ContributionReward = 'ContributionRewardExt' // propose a contributionReward
// }

export class CompetitionScheme extends SchemeBase {
  public state(apolloQueryOptions: IApolloQueryOptions = {}): Observable<ISchemeState> {
    const query = gql`query SchemeState
      {
        controllerScheme (id: "${this.id}") {
          ...SchemeFields
        }
      }
      ${SchemeBase.fragments.SchemeFields}
    `

    const itemMap = (item: any): ISchemeState|null => {
      if (!item) {
        return null
      }

      let name = item.name
      if (!name) {

        try {
          name = this.context.getContractInfo(item.address).name
        } catch (err) {
          if (err.message.match(/no contract/ig)) {
            // continue
          } else {
            throw err
          }
        }
      }
      const uGenericSchemeParams = item.uGenericSchemeParams && {
        contractToCall: item.uGenericSchemeParams.contractToCall,
        voteParams: mapGenesisProtocolParams(item.uGenericSchemeParams.voteParams),
        votingMachine: item.uGenericSchemeParams.votingMachine
      }
      const contributionRewardParams = item.contributionRewardParams && {
        voteParams: mapGenesisProtocolParams(item.contributionRewardParams.voteParams),
        votingMachine: item.contributionRewardParams.votingMachine
      }
      const contributionRewardExtParams = item.contributionRewardExtParams && {
        rewarder: item.contributionRewardExtParams.rewarder,
        voteParams: mapGenesisProtocolParams(item.contributionRewardExtParams.voteParams),
        votingMachine: item.contributionRewardExtParams.votingMachine
      }
      const schemeRegistrarParams = item.schemeRegistrarParams && {
        voteRegisterParams: mapGenesisProtocolParams(item.schemeRegistrarParams.voteRegisterParams),
        voteRemoveParams: mapGenesisProtocolParams(item.schemeRegistrarParams.voteRemoveParams),
        votingMachine: item.schemeRegistrarParams.votingMachine
      }
      const genericSchemeParams = item.genericSchemeParams  && {
        contractToCall: item.genericSchemeParams.contractToCall,
        voteParams: mapGenesisProtocolParams(item.genericSchemeParams.voteParams),
        votingMachine: item.genericSchemeParams.votingMachine
      }
      const schemeParams = (
        uGenericSchemeParams || contributionRewardParams ||
        schemeRegistrarParams || genericSchemeParams || contributionRewardExtParams
      )
      return {
        address: item.address,
        canDelegateCall: item.canDelegateCall,
        canManageGlobalConstraints: item.canManageGlobalConstraints,
        canRegisterSchemes: item.canRegisterSchemes,
        canUpgradeController: item.canUpgradeController,
        contributionRewardExtParams,
        contributionRewardParams,
        dao: item.dao.id,
        genericSchemeParams,
        id: item.id,
        name,
        numberOfBoostedProposals: Number(item.numberOfBoostedProposals),
        numberOfPreBoostedProposals: Number(item.numberOfPreBoostedProposals),
        numberOfQueuedProposals: Number(item.numberOfQueuedProposals),
        paramsHash: item.paramsHash,
        schemeParams,
        schemeRegistrarParams,
        uGenericSchemeParams,
        version: item.version
      }
    }
    return  this.context.getObservableObject(query, itemMap, apolloQueryOptions) as Observable<ISchemeState>
  }
  /**
   * Return a list of competitions in this scheme.
   * @param options
   * @param apolloQueryOptions
   */
  public competitions(
    options: IProposalQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<Competition[]> {
    // TODO: This function will error if the current scheme is not a competiion scheme
    // const staticState = await this.fetchStaticState()
    // if (staticState.name !== `ContributionRewardExt`) {
    //   // TODO: we should also check if the calling
    //   throw Error(`This scheme is not a competition scheme - so no competitions can be found`)
    // }
    if (!options.where) { options.where = {}}
    options.where = { ...options.where, competition_not: null}
    return Competition.search(this.context, options, apolloQueryOptions)
  }

  /**
   *
   * @param options
   * @param context
   */
  public createProposalTransaction(options: IProposalCreateOptionsCompetition) {
    // we assume this function is called with the correct scheme options..
    return async () => {
      const context = this.context
      const schemeState = await this.state().pipe(first()).toPromise()
      if (!schemeState) {
        throw Error(`No scheme was found with this id: ${this.id}`)
      }
      const contract = getCompetitionContract(schemeState, this.context)

      // check sanity -- is the competition contract actually c
      const contributionRewardExtAddress = await contract.methods.contributionRewardExt().call()
      if (contributionRewardExtAddress.toLowerCase() !== schemeState.address) {
        throw Error(`This ContributionRewardExt/Competition combo is malconfigured: expected ${contributionRewardExtAddress.toLowerCase()} to equal ${schemeState.address}`)
      }

      options.descriptionHash = await context.saveIPFSData(options)
      if (!options.rewardSplit) {
          throw Error(`Rewardsplit was not given..`)
        } else {
          if (options.rewardSplit.reduce((a: number, b: number) => a + b) !== 100) {
            throw Error(`Rewardsplit must sum 100 (they sum to  ${options.rewardSplit.reduce((a: number, b: number) => a + b) })`)
          }
        }
        // * @param _rewardSplit an array of precentages which specify how to split the rewards
        // *         between the winning suggestions
        // * @param _competitionParams competition parameters :
        // *         _competitionParams[0] - competition startTime
        // *         _competitionParams[1] - _votingStartTime competition voting start time
        // *         _competitionParams[2] - _endTime competition end time
        // *         _competitionParams[3] - _maxNumberOfVotesPerVoter on how many suggestions a voter can vote
        // *         _competitionParams[4] - _suggestionsEndTime suggestion submition end time
        // *         _competitionParams[4] - _suggestionsEndTime suggestion submition end time

      const competitionParams = [
          dateToSecondsSinceEpoch(options.startTime) || 0,
          dateToSecondsSinceEpoch(options.votingStartTime) || 0,
          dateToSecondsSinceEpoch(options.endTime) || 0,
          options.numberOfVotesPerVoter.toString() || 0,
          dateToSecondsSinceEpoch(options.suggestionsEndTime) || 0
        ]

      const transaction = contract.methods.proposeCompetition(
          options.descriptionHash || '',
          options.reputationReward && options.reputationReward.toString() || 0,
          [
            options.nativeTokenReward && options.nativeTokenReward.toString() || 0,
            options.ethReward && options.ethReward.toString() || 0,
            options.externalTokenReward && options.externalTokenReward.toString() || 0
          ],
          options.externalTokenAddress || NULL_ADDRESS,
          options.rewardSplit,
          competitionParams
        )
      return transaction
    }
  }
  public createProposalTransactionMap() {
    const eventName = 'NewCompetitionProposal'
    const txMap = (receipt: any) => {
      const proposalId = receipt.events[eventName].returnValues._proposalId
      return new Proposal(proposalId, this.context)
    }
    return txMap
  }

  public createProposal(options: IProposalCreateOptionsCompetition): Operation<Proposal>  {
    return SchemeBase.prototype.createProposal.call(this, options)
  }

  public createSuggestion(options: {
    proposalId: string,
    title: string,
    description: string,
    tags: string[],
    url: string
  }): Operation < any > {
    const createTransaction = async () => {
      const schemeState = await this.state().pipe(first()).toPromise()
      const contract = getCompetitionContract(schemeState, this.context)
      const descriptionHash = await this.context.saveIPFSData(options)
      const transaction = contract.methods.suggest(options.proposalId, descriptionHash)
      return transaction
    }

    const mapReceipt = (receipt: any) => {
      if (Object.keys(receipt.events).length === 0) {
        // this does not mean that anything failed
        return receipt
      } else {
        const eventName = 'NewSuggestion'
        const suggestionId = receipt.events[eventName].returnValues._suggestionId
        // const competitionSuggestionId = CompetitionSuggestion.calculateId({
        //   scheme: this.id,
        //   suggestionId
        // })
        return new CompetitionSuggestion({scheme: this.id, suggestionId}, this.context)
      }
    }
    const errorHandler = async (err: Error) => {
      // we got an error
      // see if the proposalId does exist in the contract
      const schemeState = await this.state().pipe(first()).toPromise()
      const contract = getCompetitionContract(schemeState, this.context)
      const proposal = await contract.methods.proposals(options.proposalId).call()
      if (!proposal) {
        throw Error(`A proposal with id ${options.proposalId} does not exist`)
      }
      return err
    }
    const observable = this.context.sendTransaction(createTransaction, mapReceipt, errorHandler)
    return toIOperationObservable(observable)
  }

  public vote(options: {
    suggestionId: string // this is the suggestion COUNTER
  }): Operation < any > {
    const createTransaction = async () => {
      const schemeState = await this.state().pipe(first()).toPromise()
      const contract = getCompetitionContract(schemeState, this.context)
      const transaction = contract.methods.vote(options.suggestionId)
      return transaction
    }

    const mapReceipt = (receipt: any) => {
      if (Object.keys(receipt.events).length === 0) {
        // this does not mean that anything failed
        return receipt
      } else {
        const eventName = 'NewVote'
        // emit NewVote(proposalId, _suggestionId, msg.sender, reputation);
        // const suggestionId = receipt.events[eventName].returnValues._suggestionId
        const voter = receipt.events[eventName].returnValues._voter
        const reputation = receipt.events[eventName].returnValues._reputation
        return new CompetitionVote({
          reputation,
          voter
        }, this.context)
      }
    }
    const errorHandler = async (err: Error) => {
      const schemeState = await this.state().pipe(first()).toPromise()
      const contract = getCompetitionContract(schemeState, this.context)
      // see if the suggestionId does exist in the contract
      const suggestion = await contract.methods.suggestions(options.suggestionId).call()
      if (suggestion.proposalId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        throw Error(`A suggestion with suggestionId ${options.suggestionId} does not exist`)
      }

      // check if the sender has reputation in the DAO
      const state = await this.state().pipe(first()).toPromise()
      const dao = new DAO(state.dao, this.context)
      const reputation = await dao.nativeReputation().pipe(first()).toPromise()
      const sender = await this.context.getAccount().pipe(first()).toPromise()
      const reputationOfUser = await reputation.reputationOf(sender).pipe(first()).toPromise()
      if (reputationOfUser.isZero()) {
        throw Error(`Cannot vote because the user ${sender} does not have any reputation in the DAO at ${dao.id}`)
      }
      return err
    }
    const observable = this.context.sendTransaction(createTransaction, mapReceipt, errorHandler)
    return toIOperationObservable(observable)
  }

}

export function createProposalErrorHandler(err: Error) {
  return err
}

export class Competition { // extends Proposal {
  public static search(
    context: Arc,
    options: IProposalQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<Competition[]> {
    return Proposal.search(context, options, apolloQueryOptions).pipe(
      map((proposals: Proposal[]) => proposals.map((p: Proposal) => new Competition(p.id, context)))
    )
  }
  public id: string
  public context: Arc
  constructor(id: string, context: Arc) {
    // super(id, context)
    this.id = id
    this.context = context
  }

  public suggestions(
      options: ICompetitionSuggestionQueryOptions = {},
      apolloQueryOptions: IApolloQueryOptions = {}
    ): Observable < CompetitionSuggestion[] > {
    if (!options.where) { options.where = {}}
    options.where.proposal = this.id
    return  CompetitionSuggestion.search(this.context, options, apolloQueryOptions)
  }
}

export interface ICompetitionSuggestionQueryOptions {
  where?: {
    proposal?: string
  }
}
export class CompetitionSuggestion {

  public static fragments = {
    CompetitionSuggestionFields: gql`fragment CompetitionSuggestionFields on CompetitionSuggestion {
      id
      suggestionId
      # proposal: CompetitionProposal!
      descriptionHash
      title
      description
      url
      # fulltext: [string]
      suggester
      # votes: [CompetitionVote!] @derivedFrom(field: "suggestion")
      totalVotes
      createdAt
      redeemedAt
      rewardPercentage
    }`
  }

  public static calculateId(opts: { scheme: Address, suggestionId: number}): string {
    const seed = concat(
      hexStringToUint8Array(opts.scheme.toLowerCase()),
      hexStringToUint8Array(Number(opts.suggestionId).toString(16))
    )
    return Web3.utils.keccak256(seed)
  }

  public static search(
    context: Arc,
    options: ICompetitionSuggestionQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<CompetitionSuggestion[]> {
    let where = ''
    if (!options.where) { options.where = {}}

    for (const key of Object.keys(options.where)) {
      if (options.where[key] === undefined) {
        continue
      }

      if (key === 'beneficiary' || key === 'dao') {
        const option = options.where[key] as string
        isAddress(option)
        options.where[key] = option.toLowerCase()
      }

      where += `${key}: "${options.where[key] as string}"\n`
    }

    const itemMap = (item: any) => new CompetitionSuggestion({
      createdAt: secondSinceEpochToDate(item.createdAt),
      descriptionHash: item.descriptionHash,
      id: item.id,
      proposal: item.proposal,
      redeemedAt: secondSinceEpochToDate(item.redeemedAt),
      rewardPercentage: Number(item.rewardPercentage),
      suggester: item.suggester,
      suggestionId: item.suggestionId,
      totalVotes: new BN(item.totalVotes)
    }, context)

    const query = gql`query CompetitionSuggestionSearch
      {
        competitionSuggestions ${createGraphQlQuery(options, where)} {
          ...CompetitionSuggestionFields
        }
      }
      ${CompetitionSuggestion.fragments.CompetitionSuggestionFields}
      `

    return context.getObservableList(
      query,
      itemMap,
      apolloQueryOptions
    ) as Observable<CompetitionSuggestion[]>
  }

  public id: string
  public suggestionId?: number
  public staticState?: ICompetitionSuggestion

  constructor(idOrOpts: string|{ suggestionId: number, scheme: string}|ICompetitionSuggestion, public context: Arc) {
     if (typeof idOrOpts === 'string') {
      this.id = idOrOpts
    } else {
      if (
        Object.keys(idOrOpts).includes('scheme') &&
        Object.keys(idOrOpts).includes('suggestionId')
        ) {
        this.id = CompetitionSuggestion.calculateId(idOrOpts as { suggestionId: number, scheme: string})
        this.suggestionId = idOrOpts.suggestionId
      } else {
        const opts = idOrOpts as ICompetitionSuggestion
        this.id = opts.id
        this.setStaticState(opts)
      }
    }
  }

  public setStaticState(opts: ICompetitionSuggestion) {
    this.staticState = opts
  }

  // public vote(options: {
  //   suggestionId: string
  // }): Operation<any> {
  //   return this.scheme().pipe(map((scheme: Scheme) => scheme.competitionVote(suggestionId))
  // }

}
export interface ICompetitionVoteQueryOptions {
  where?: {
    suggestion?: string
  }
}

export class CompetitionVote {

  public static fragments = {
    CompetitionVoteFields: gql`fragment CompetitionVoteFields on CompetitionVote {
      id
      createdAt
      reptutation
      voter
    }`
  }
  public static calculateId(opts: { scheme: Address, suggestionId: number}): string {
    const seed = concat(
      hexStringToUint8Array(opts.scheme.toLowerCase()),
      hexStringToUint8Array(Number(opts.suggestionId).toString(16))
    )
    return Web3.utils.keccak256(seed)
  }

  public static search(
    context: Arc,
    options: ICompetitionVoteQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<CompetitionVote[]> {
    if (!options.where) { options.where = {}}

    const itemMap = (item: any) => new CompetitionVote({
      createdAt: secondSinceEpochToDate(item.createdAt),
      id: item.id,
      reputation: item.reptutation,
      voter: item.voter
    }, context)

    const query = gql`query CompetitionSuggestionSearch
      {
        competitionVotes ${createGraphQlQuery(options)} {
          ...CompetitionVoteFields
        }
      }
      ${CompetitionVote.fragments.CompetitionVoteFields}
      `

    return context.getObservableList(
      query,
      itemMap,
      apolloQueryOptions
    ) as Observable<CompetitionVote[]>
  }
  public id?: string
  public staticState?: ICompetitionVote

  constructor(idOrOpts: string|ICompetitionVote, public context: Arc) {
    if (typeof idOrOpts === 'string') {
      this.id = idOrOpts
    } else {
      const opts = idOrOpts as ICompetitionVote
      // this.id = opts.id
      this.setStaticState(opts)
    }
  }

  public setStaticState(opts: ICompetitionVote) {
    this.staticState = opts
  }
}

/**
 * If this scheme is a ContributionREwardExt scheme and if
 * its rewarder is Competition contract, return that contract
 * @param schemeState
 * @returns A Web3 contract instance
 */
export function getCompetitionContract(schemeState: ISchemeState, arc: Arc) {
  if (schemeState === null) {
    throw Error(`No scheme was provided`)
  }
  const rewarder = schemeState.contributionRewardExtParams && schemeState.contributionRewardExtParams.rewarder
  if (!rewarder) {
    throw Error(`This scheme's rewarder is not set, and so no compeittion contract could be found`)
  }

  if (!isCompetitionScheme(arc, schemeState)) {
    throw Error(`We did not find a Competition contract at the rewarder address ${rewarder}`)
  }
  const contract = arc.getContract(rewarder as Address)
  return contract
}

export function isCompetitionScheme(arc: Arc, item: any) {
  if (item.contributionRewardExtParams) {
    const contractInfo = arc.getContractInfo(item.contributionRewardExtParams.rewarder)
    return contractInfo.name === 'Competition'
  } else {
    return false
  }
}

/**
 * @returns true if this is a ContributionRewardExt scheme and the rewarder of this scheme is a competition contract
 */
export function hasCompetitionContract(schemeState: ISchemeState, arc: Arc) {
  let contract
  try {
    contract = getCompetitionContract(schemeState, arc)
  } catch (err) {
    // pass
  }
  return !!contract
}