import { from } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import {
  ITransaction,
  Operation,
  toIOperationObservable,
  Address,
  Plugin,
  Arc,
  IPluginState
} from '../../index'
import { DocumentNode } from 'graphql'

export class ReputationFromToken extends Plugin<IPluginState> {

  public static itemMap(context: Arc, item: any, query: DocumentNode): IPluginState | null {
    if (!item) {
      console.log(`ReputationFromToken Plugin ItemMap failed. Query: ${query.loc?.source.body}`)
      return null
    }

    return Plugin.itemMapToBaseState(context, item)
  }

  public async getAgreementHash(): Promise<string> {
    const contract = await this.getContract()
    const result = await contract.getAgreementHash()
    return result
  }

  public redeem(beneficiary: Address, agreementHash?: string): Operation<undefined> {

    const createTransaction = async (): Promise<ITransaction> => {
      return {
        contract: await this.getContract(),
        method: 'redeem',
        args: [ beneficiary ]
      }
    }

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction)
      })
    )

    return toIOperationObservable(observable)
  }

  public async getContract() {
    const state = await this.fetchState()
    const contract = this.context.getContract(state.address)
    return contract
  }
}